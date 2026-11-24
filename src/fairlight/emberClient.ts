import { EmberClient, Model } from "@phillipivan/emberplus-connection";

import { BUS_TYPES, type BusType, type FairlightConfig } from "../config.js";
import { FairlightError } from "../errors.js";
import type { Logger } from "../logger.js";
import {
  auxSendKey,
  busKey,
  cloneBus,
  cloneChannel,
  cloneMonitor,
  type BusField,
  type BusState,
  type ChannelField,
  type ChannelState,
  type FairlightClient,
  type FairlightEvent,
  type FairlightEventListener,
  type FairlightSnapshot,
  type MonitorField,
  type MonitorState,
  type SendState,
  type StructureChangeSummary,
} from "./types.js";

interface EmberParameterContents {
  type: string;
  identifier?: string;
  description?: string;
  value?: unknown;
  parameterType?: string;
  access?: string;
  isOnline?: boolean;
}

interface EmberNodeLike {
  number?: number;
  path?: string;
  contents: EmberParameterContents;
  children?: unknown;
}

type DirectoryArg = Parameters<EmberClient["getDirectory"]>[0];
type SubscribeArg = Parameters<EmberClient["subscribe"]>[0];
type SetValueArg = Parameters<EmberClient["setValue"]>[0];

interface SendEntry {
  state: SendState;
  levelNode: EmberNodeLike | null;
  muteNode: EmberNodeLike | null;
  panNode: EmberNodeLike | null;
}

interface ChannelEntry {
  state: ChannelState;
  node: EmberNodeLike;
  levelNode: EmberNodeLike | null;
  muteNode: EmberNodeLike | null;
  nameNode: EmberNodeLike | null;
  panNode: EmberNodeLike | null;
  meterNode: EmberNodeLike | null;
  sends: Map<string, SendEntry>;
}

interface BusEntry {
  state: BusState;
  node: EmberNodeLike;
  levelNode: EmberNodeLike | null;
  muteNode: EmberNodeLike | null;
  nameNode: EmberNodeLike | null;
  panNode: EmberNodeLike | null;
  meterNode: EmberNodeLike | null;
  integratedNode: EmberNodeLike | null;
}

interface MonitorEntry {
  state: MonitorState;
  node: EmberNodeLike;
  levelNode: EmberNodeLike | null;
  muteNode: EmberNodeLike | null;
  nameNode: EmberNodeLike | null;
  dimNode: EmberNodeLike | null;
}

export interface EmberFairlightOptions extends FairlightConfig {
  autoReconnect: boolean;
  logger: Logger;
  watchChannelNames?: number[];
  subscribeMeters?: boolean;
  watchAuxSends?: number[];
  watchMonitors?: number[];
}

const LEVEL_CONFIRM_EPSILON_DB = 0.05;
const PAN_CONFIRM_EPSILON = 1;

function quantiseLevelDb(db: number): number {
  return Number(db.toFixed(1));
}

function quantisePan(pan: number): number {
  return Math.min(100, Math.max(-100, Math.round(pan)));
}

function collectionValues(collection: unknown): EmberNodeLike[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.filter((entry): entry is EmberNodeLike => Boolean(entry?.contents));
  if (collection instanceof Map) {
    return [...collection.values()].filter((entry): entry is EmberNodeLike => Boolean(entry?.contents));
  }
  if (typeof collection === "object") {
    return Object.values(collection as Record<string, EmberNodeLike>).filter(
      (entry): entry is EmberNodeLike => Boolean(entry?.contents),
    );
  }
  return [];
}

function childNodes(node: EmberNodeLike): EmberNodeLike[] {
  return collectionValues(node.children);
}

function hasChildren(node: EmberNodeLike): boolean {
  return childNodes(node).length > 0;
}

function nodeLabel(node: EmberNodeLike): string {
  return node.contents.identifier ?? node.contents.description ?? String(node.number ?? "?");
}

function rootMatches(node: EmberNodeLike, wanted: string): boolean {
  return (
    (node.contents.identifier ?? "").toLowerCase() === wanted ||
    (node.contents.description ?? "").toLowerCase() === wanted
  );
}

function busRootMatches(node: EmberNodeLike, type: BusType): boolean {
  if (type === "vca") {
    return rootMatches(node, "vca") || rootMatches(node, "dca");
  }
  return rootMatches(node, type);
}

function monitorRootMatches(node: EmberNodeLike): boolean {
  const identifier = (node.contents.identifier ?? "").toLowerCase();
  const description = (node.contents.description ?? "").toLowerCase();
  return identifier.startsWith("monitor") || description.startsWith("monitor");
}

/**
 * Tolerant label match used for the on-air path: lowercases and drops separators
 * so `onAir`, `onair`, `on-air` and `ON_AIR` are all accepted.
 */
function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function labelMatches(node: EmberNodeLike, wanted: string): boolean {
  const key = normaliseLabel(wanted);
  return (
    normaliseLabel(node.contents.identifier ?? "") === key ||
    normaliseLabel(node.contents.description ?? "") === key
  );
}

function findSystemRoot(roots: EmberNodeLike[]): EmberNodeLike | null {
  return roots.find((root) => isParameterLikeRoot(root) && labelMatches(root, "system")) ?? null;
}

function findOnAirParameter(parent: EmberNodeLike): EmberNodeLike | null {
  return (
    childNodes(parent).find((child) => isParameter(child) && labelMatches(child, "onair")) ?? null
  );
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isParameter(node: EmberNodeLike): boolean {
  return node.contents.type === Model.ElementType.Parameter;
}

function isWritable(node: EmberNodeLike): boolean {
  const access = node.contents.access;
  return access === Model.ParameterAccess.ReadWrite || access === Model.ParameterAccess.Write;
}

function findParameter(parent: EmberNodeLike, identifier: string): EmberNodeLike | null {
  const wanted = identifier.toLowerCase();
  return (
    childNodes(parent).find(
      (child) =>
        isParameter(child) &&
        ((child.contents.identifier ?? "").toLowerCase() === wanted ||
          (child.contents.description ?? "").toLowerCase() === wanted),
    ) ?? null
  );
}

function findNode(parent: EmberNodeLike, identifier: string): EmberNodeLike | null {
  const wanted = identifier.toLowerCase();
  return (
    childNodes(parent).find(
      (child) =>
        !isParameter(child) &&
        ((child.contents.identifier ?? "").toLowerCase() === wanted ||
          (child.contents.description ?? "").toLowerCase() === wanted),
    ) ?? null
  );
}

/** Finds a meter parameter either directly or inside a `meters` container. */
function findMetersParameter(parent: EmberNodeLike, identifier: string): EmberNodeLike | null {
  const direct = findParameter(parent, identifier);
  if (direct) return direct;
  const metersNode = findNode(parent, "meters");
  if (!metersNode) return null;
  return findParameter(metersNode, identifier);
}

function findMeterParameter(parent: EmberNodeLike): EmberNodeLike | null {
  return findMetersParameter(parent, "meter");
}

function channelName(node: EmberNodeLike, nameNode: EmberNodeLike | null, index: number): string {
  const parameterName = readString(nameNode?.contents.value);
  if (parameterName && parameterName.trim() !== "") return parameterName;
  const description = node.contents.description;
  if (description && description.trim() !== "") return description;
  return `CH ${index}`;
}

function busName(node: EmberNodeLike, nameNode: EmberNodeLike | null, type: BusType, index: number): string {
  const parameterName = readString(nameNode?.contents.value);
  if (parameterName && parameterName.trim() !== "") return parameterName;
  const description = node.contents.description;
  if (description && description.trim() !== "") return description;
  return `${type} ${index}`;
}

function monitorName(node: EmberNodeLike, nameNode: EmberNodeLike | null, index: number): string {
  const parameterName = readString(nameNode?.contents.value);
  if (parameterName && parameterName.trim() !== "") return parameterName;
  const description = node.contents.description;
  if (description && description.trim() !== "") return description;
  return `MON ${index}`;
}

function diffSnapshots(previous: FairlightSnapshot | null, next: FairlightSnapshot): StructureChangeSummary {
  const summary: StructureChangeSummary = {
    addedChannels: [],
    removedChannels: [],
    renamedChannels: [],
    addedBuses: [],
    removedBuses: [],
  };
  if (!previous) return summary;
  const previousChannels = new Map(previous.channels.map((channel) => [channel.index, channel]));
  const nextChannels = new Map(next.channels.map((channel) => [channel.index, channel]));
  for (const [index, channel] of nextChannels) {
    const before = previousChannels.get(index);
    if (!before) summary.addedChannels.push(index);
    else if (before.name !== channel.name) summary.renamedChannels.push({ index, before: before.name, after: channel.name });
  }
  for (const index of previousChannels.keys()) {
    if (!nextChannels.has(index)) summary.removedChannels.push(index);
  }
  const previousBuses = new Map(previous.buses.map((bus) => [busKey(bus.type, bus.index), bus]));
  const nextBuses = new Map(next.buses.map((bus) => [busKey(bus.type, bus.index), bus]));
  for (const key of nextBuses.keys()) {
    if (!previousBuses.has(key)) summary.addedBuses.push(key);
  }
  for (const key of previousBuses.keys()) {
    if (!nextBuses.has(key)) summary.removedBuses.push(key);
  }
  summary.addedChannels.sort((a, b) => a - b);
  summary.removedChannels.sort((a, b) => a - b);
  summary.addedBuses.sort();
  summary.removedBuses.sort();
  return summary;
}

function hasStructureChanges(summary: StructureChangeSummary): boolean {
  return (
    summary.addedChannels.length > 0 ||
    summary.removedChannels.length > 0 ||
    summary.renamedChannels.length > 0 ||
    summary.addedBuses.length > 0 ||
    summary.removedBuses.length > 0
  );
}

export class EmberFairlightClient implements FairlightClient {
  readonly #options: EmberFairlightOptions;
  readonly #logger: Logger;
  readonly #listeners = new Set<FairlightEventListener>();
  #client: EmberClient | undefined;
  #connected = false;
  #stopped = false;
  #session = 0;
  #revision = 0;
  #retryAttempt = 0;
  #retryTimer: NodeJS.Timeout | undefined;
  #connectPromise: Promise<void> | undefined;
  #discoverChain: Promise<void> = Promise.resolve();
  #refreshTimer: NodeJS.Timeout | undefined;
  #discoveryDepth = 0;
  #structureDetected = false;
  #structureEpoch = 0;
  #structureReason: string | null = null;
  #subscriptionKeys = new Set<string>();
  #channels = new Map<number, ChannelEntry>();
  #buses = new Map<string, BusEntry>();
  #monitors = new Map<number, MonitorEntry>();
  #onAir: boolean | null = null;
  #onAirNode: EmberNodeLike | null = null;
  #lastSnapshot: FairlightSnapshot | null = null;

  constructor(options: EmberFairlightOptions) {
    this.#options = options;
    this.#logger = options.logger.child({ component: "fairlight" });
  }

  get connected(): boolean {
    return this.#connected;
  }

  onEvent(listener: FairlightEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.#stopped = false;
    if (this.#connected) return;
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = this.#attemptConnect().finally(() => {
      this.#connectPromise = undefined;
    });
    return this.#connectPromise;
  }

  async disconnect(): Promise<void> {
    this.#stopped = true;
    this.#clearRetry();
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = undefined;
    }
    const client = this.#client;
    this.#client = undefined;
    this.#connected = false;
    this.#session += 1;
    this.#subscriptionKeys.clear();
    this.#structureDetected = false;
    this.#structureReason = null;
    this.#applyOnAir(null);
    this.#onAirNode = null;
    const wasConnected = client !== undefined;
    if (client) {
      const transport = client as unknown as { _client?: { handleClose?: () => void } };
      const s101 = transport._client;
      try {
        client.discard();
      } catch (error) {
        this.#logger.warn("fairlight.discard_failed", { error });
      }
      try {
        s101?.handleClose?.();
      } catch (error) {
        this.#logger.warn("fairlight.socket_close_failed", { error });
      }
    }
    if (wasConnected) this.#emit({ type: "disconnected", reason: "bridge stopped" });
  }

  snapshot(): FairlightSnapshot {
    return {
      revision: this.#revision,
      discoveredAt: new Date().toISOString(),
      onAir: this.#onAir,
      channels: [...this.#channels.values()].map((entry) => cloneChannel(entry.state)).sort((a, b) => a.index - b.index),
      buses: [...this.#buses.values()]
        .map((entry) => cloneBus(entry.state))
        .sort((a, b) => (a.type === b.type ? a.index - b.index : a.type.localeCompare(b.type))),
      monitors: [...this.#monitors.values()]
        .map((entry) => cloneMonitor(entry.state))
        .sort((a, b) => a.index - b.index),
    };
  }

  async setChannelLevel(index: number, db: number): Promise<number> {
    const entry = this.#channels.get(index);
    if (!entry) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} is not available`);
    if (!entry.levelNode || !entry.state.writableLevel) {
      throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} level is read-only or missing`);
    }
    const requested = quantiseLevelDb(db);
    const confirmed = await this.#writeParameter(entry.levelNode, requested, "level");
    const numeric = readNumber(confirmed);
    if (numeric === null || Math.abs(numeric - requested) > LEVEL_CONFIRM_EPSILON_DB) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm channel ${index} level`, {
        channel: index,
        requested,
        confirmed,
      });
    }
    if (entry.state.levelDb !== numeric) this.#applyChannelField(entry, "level", numeric, false);
    this.#logger.debug("fairlight.level_confirmed", { channel: index, db: numeric });
    return numeric;
  }

  async setChannelMute(index: number, muted: boolean): Promise<boolean> {
    const entry = this.#channels.get(index);
    if (!entry) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} is not available`);
    if (!entry.muteNode || !entry.state.writableMute) {
      throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} mute is read-only or missing`);
    }
    const confirmed = await this.#writeParameter(entry.muteNode, muted, "mute");
    const boolean = readBoolean(confirmed);
    if (boolean === null || boolean !== muted) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm channel ${index} mute`, {
        channel: index,
        requested: muted,
        confirmed,
      });
    }
    if (entry.state.muted !== boolean) this.#applyChannelField(entry, "mute", boolean, false);
    return boolean;
  }

  async setChannelPan(index: number, pan: number): Promise<number> {
    const entry = this.#channels.get(index);
    if (!entry) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} is not available`);
    if (!entry.panNode || !entry.state.writablePan) {
      throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} pan is read-only or missing`);
    }
    const requested = quantisePan(pan);
    const confirmed = await this.#writeParameter(entry.panNode, requested, "pan");
    const numeric = readNumber(confirmed);
    if (numeric === null || Math.abs(numeric - requested) > PAN_CONFIRM_EPSILON) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm channel ${index} pan`, {
        channel: index,
        requested,
        confirmed,
      });
    }
    if (entry.state.pan !== numeric) this.#applyChannelField(entry, "pan", numeric, false);
    return numeric;
  }

  async setChannelSendLevel(index: number, auxIndex: number, db: number): Promise<number> {
    const entry = this.#channels.get(index);
    if (!entry) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} is not available`);
    const send = entry.sends.get(auxSendKey(auxIndex));
    if (!send || !send.state.writableLevel || !send.levelNode) {
      throw new FairlightError(
        "SEND_NOT_FOUND",
        `Fairlight channel ${index} aux ${auxIndex} send is missing or read-only`,
      );
    }
    const requested = quantiseLevelDb(db);
    const confirmed = await this.#writeParameter(send.levelNode, requested, "send level");
    const numeric = readNumber(confirmed);
    if (numeric === null || Math.abs(numeric - requested) > LEVEL_CONFIRM_EPSILON_DB) {
      throw new FairlightError(
        "WRITE_UNCONFIRMED",
        `Fairlight did not confirm channel ${index} aux ${auxIndex} send level`,
        { channel: index, aux: auxIndex, requested, confirmed },
      );
    }
    if (send.state.levelDb !== numeric) {
      send.state.levelDb = numeric;
      entry.state.sends[auxSendKey(auxIndex)] = { ...send.state };
      this.#revision += 1;
      this.#emit({ type: "channel", channel: cloneChannel(entry.state), changed: ["send"] });
    }
    this.#logger.debug("fairlight.send_level_confirmed", { channel: index, aux: auxIndex, db: numeric });
    return numeric;
  }

  async setBusLevel(type: BusType, index: number, db: number): Promise<number> {
    const entry = this.#buses.get(busKey(type, index));
    if (!entry) throw new FairlightError("BUS_NOT_FOUND", `Fairlight bus ${type}:${index} is not available`);
    if (!entry.levelNode || !entry.state.writableLevel) {
      throw new FairlightError("BUS_READ_ONLY", `Fairlight bus ${type}:${index} level is read-only or missing`);
    }
    const requested = quantiseLevelDb(db);
    const confirmed = await this.#writeParameter(entry.levelNode, requested, "level");
    const numeric = readNumber(confirmed);
    if (numeric === null || Math.abs(numeric - requested) > LEVEL_CONFIRM_EPSILON_DB) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm bus ${type}:${index} level`, {
        type,
        index,
        requested,
        confirmed,
      });
    }
    if (entry.state.levelDb !== numeric) this.#applyBusField(entry, "level", numeric, false);
    return numeric;
  }

  async setBusMute(type: BusType, index: number, muted: boolean): Promise<boolean> {
    const entry = this.#buses.get(busKey(type, index));
    if (!entry) throw new FairlightError("BUS_NOT_FOUND", `Fairlight bus ${type}:${index} is not available`);
    if (!entry.muteNode || !entry.state.writableMute) {
      throw new FairlightError("BUS_READ_ONLY", `Fairlight bus ${type}:${index} mute is read-only or missing`);
    }
    const confirmed = await this.#writeParameter(entry.muteNode, muted, "mute");
    const boolean = readBoolean(confirmed);
    if (boolean === null || boolean !== muted) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm bus ${type}:${index} mute`, {
        type,
        index,
        requested: muted,
        confirmed,
      });
    }
    if (entry.state.muted !== boolean) this.#applyBusField(entry, "mute", boolean, false);
    return boolean;
  }

  async setBusPan(type: BusType, index: number, pan: number): Promise<number> {
    const entry = this.#buses.get(busKey(type, index));
    if (!entry) throw new FairlightError("BUS_NOT_FOUND", `Fairlight bus ${type}:${index} is not available`);
    if (!entry.panNode || !entry.state.writablePan) {
      throw new FairlightError("BUS_READ_ONLY", `Fairlight bus ${type}:${index} pan is read-only or missing`);
    }
    const requested = quantisePan(pan);
    const confirmed = await this.#writeParameter(entry.panNode, requested, "pan");
    const numeric = readNumber(confirmed);
    if (numeric === null || Math.abs(numeric - requested) > PAN_CONFIRM_EPSILON) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm bus ${type}:${index} pan`, {
        type,
        index,
        requested,
        confirmed,
      });
    }
    if (entry.state.pan !== numeric) this.#applyBusField(entry, "pan", numeric, false);
    return numeric;
  }

  async setMonitorDim(index: number, dimmed: boolean): Promise<boolean> {
    const entry = this.#monitors.get(index);
    if (!entry) throw new FairlightError("MONITOR_NOT_FOUND", `Fairlight monitor ${index} is not available`);
    if (!entry.dimNode || !entry.state.writableDim) {
      throw new FairlightError("MONITOR_READ_ONLY", `Fairlight monitor ${index} dim is read-only or missing`);
    }
    const confirmed = await this.#writeParameter(entry.dimNode, dimmed, "dim");
    const boolean = readBoolean(confirmed);
    if (boolean === null || boolean !== dimmed) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm monitor ${index} dim`, {
        monitor: index,
        requested: dimmed,
        confirmed,
      });
    }
    if (entry.state.dimmed !== boolean) this.#applyMonitorField(entry, "dim", boolean, false);
    return boolean;
  }

  async #attemptConnect(): Promise<void> {
    if (this.#stopped) return;
    this.#clearRetry();
    this.#connected = false;
    this.#subscriptionKeys.clear();
    const client = new EmberClient(this.#options.host, this.#options.port, {
      timeout: this.#options.requestTimeoutMs,
      enableResends: false,
      getDirectoryOnParams: false,
    });
    this.#client = client;
    const session = (this.#session += 1);

    client.on("error", (error) => {
      if (this.#client !== client) return;
      this.#logger.warn("fairlight.ember_error", { error });
    });
    client.on("warn", (error) => {
      if (this.#client !== client) return;
      this.#logger.debug("fairlight.ember_warning", { error });
    });
    client.on("disconnected", () => {
      if (this.#client !== client || this.#stopped) return;
      this.#handleDisconnect("Ember+ connection lost");
    });

    try {
      const result = await client.connect();
      if (result instanceof Error) throw result;
      if (this.#client !== client || session !== this.#session || this.#stopped) {
        client.discard();
        return;
      }
      await this.#discover(session, true);
      this.#assertSession(session);
      this.#connected = true;
      this.#retryAttempt = 0;
      this.#logger.info("fairlight.connected", { host: this.#options.host, port: this.#options.port });
      this.#emit({ type: "connected", snapshot: this.snapshot() });
    } catch (error) {
      if (this.#client === client) this.#client = undefined;
      this.#connected = false;
      const transport = client as unknown as { _client?: { handleClose?: () => void } };
      const s101 = transport._client;
      try {
        client.discard();
      } catch {}
      try {
        s101?.handleClose?.();
      } catch {}
      if (this.#stopped) return;
      if (!this.#options.autoReconnect) {
        throw error instanceof FairlightError
          ? error
          : new FairlightError("EMBER_CONNECT_FAILED", "Cannot connect to Fairlight Ember+", {}, { cause: error });
      }
      this.#logger.warn("fairlight.connect_failed", { error });
      this.#scheduleReconnect();
    }
  }

  #handleDisconnect(reason: string): void {
    if (this.#stopped) return;
    this.#connected = false;
    this.#session += 1;
    this.#subscriptionKeys.clear();
    const client = this.#client;
    this.#client = undefined;
    if (client) {
      const transport = client as unknown as { _client?: { handleClose?: () => void } };
      const s101 = transport._client;
      try {
        client.discard();
      } catch {}
      try {
        s101?.handleClose?.();
      } catch {}
    }
    this.#logger.warn("fairlight.disconnected", { reason });
    this.#applyOnAir(null);
    this.#onAirNode = null;
    this.#emit({ type: "disconnected", reason });
    if (this.#options.autoReconnect) this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#retryTimer || !this.#options.autoReconnect) return;
    const maxAttempts = this.#options.reconnectAttempts;
    if (maxAttempts > 0 && this.#retryAttempt >= maxAttempts) {
      this.#logger.error("fairlight.reconnect_exhausted", { attempts: this.#retryAttempt });
      return;
    }
    this.#retryAttempt += 1;
    const delay = Math.min(10_000, 1000 * 2 ** Math.min(this.#retryAttempt - 1, 4));
    this.#logger.info("fairlight.reconnect_scheduled", { attempt: this.#retryAttempt, delayMs: delay });
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.connect().catch((error) => {
        this.#logger.error("fairlight.reconnect_failed", { error });
      });
    }, delay);
  }

  #clearRetry(): void {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  #discover(session: number, initial: boolean): Promise<void> {
    const run = this.#discoverChain.then(
      () => this.#performDiscover(session, initial),
      () => this.#performDiscover(session, initial),
    );
    this.#discoverChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #performDiscover(session: number, initial: boolean): Promise<void> {
    this.#discoveryDepth += 1;
    try {
      await this.#performDiscoverInner(session, initial);
    } finally {
      this.#discoveryDepth -= 1;
    }
  }

  async #discoverAuxSends(parent: EmberNodeLike, session: number): Promise<Map<string, SendEntry>> {
    const entries = new Map<string, SendEntry>();
    const wanted = this.#options.watchAuxSends ?? [];
    if (wanted.length === 0) return entries;
    const sendsNode = findNode(parent, "sends");
    if (!sendsNode) return entries;
    let sendsContainer: EmberNodeLike;
    try {
      sendsContainer = await this.#loadNode(sendsNode, session);
    } catch (error) {
      this.#logger.warn("fairlight.sends_discovery_failed", { error });
      return entries;
    }
    const auxNode = findNode(sendsContainer, "aux");
    if (!auxNode) return entries;
    let auxContainer: EmberNodeLike;
    try {
      auxContainer = await this.#loadNode(auxNode, session);
    } catch (error) {
      this.#logger.warn("fairlight.aux_sends_discovery_failed", { error });
      return entries;
    }
    for (const node of childNodes(auxContainer)) {
      if (isParameter(node)) continue;
      const index = node.number ?? 0;
      if (!wanted.includes(index)) continue;
      try {
        const loaded = await this.#loadNode(node, session);
        const params = hasChildren(loaded) ? loaded : node;
        const levelNode = findParameter(params, "level");
        const muteNode = findParameter(params, "mute");
        const panNode = findParameter(params, "pan");
        if (!levelNode && !muteNode) continue;
        entries.set(auxSendKey(index), {
          state: {
            type: "aux",
            index,
            levelDb: levelNode ? readNumber(levelNode.contents.value) : null,
            muted: muteNode ? readBoolean(muteNode.contents.value) : null,
            pan: panNode ? readNumber(panNode.contents.value) : null,
            writableLevel: levelNode !== null && isWritable(levelNode),
            writableMute: muteNode !== null && isWritable(muteNode),
            writablePan: panNode !== null && isWritable(panNode),
          },
          levelNode,
          muteNode,
          panNode,
        });
      } catch (error) {
        this.#logger.warn("fairlight.aux_send_discovery_failed", { aux: index, error });
      }
      this.#assertSession(session);
    }
    return entries;
  }

  async #discoverMonitors(roots: EmberNodeLike[], session: number): Promise<Map<number, MonitorEntry>> {
    const next = new Map<number, MonitorEntry>();
    const monitorRoot = roots.find((root) => isParameterLikeRoot(root) && monitorRootMatches(root));
    if (!monitorRoot) return next;
    let monitorContainer: EmberNodeLike;
    try {
      monitorContainer = await this.#loadNode(monitorRoot, session);
    } catch (error) {
      this.#logger.warn("fairlight.monitor_root_failed", { error });
      return next;
    }
    const monitorNodes = childNodes(monitorContainer)
      .filter((node) => node.contents.type === Model.ElementType.Node)
      .filter((node) => node.contents.isOnline !== false)
      .filter((node) => (node.number ?? 0) > 0)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    for (const monitorNode of monitorNodes) {
      const index = monitorNode.number ?? 0;
      try {
        const loaded = await this.#loadNode(monitorNode, session);
        const paramsParent = hasChildren(loaded) ? loaded : monitorNode;
        const levelNode = findParameter(paramsParent, "level");
        const muteNode = findParameter(paramsParent, "mute");
        const nameNode = findParameter(paramsParent, "name");
        const dimNode = findParameter(paramsParent, "dim");
        if (!dimNode && !levelNode && !muteNode) {
          this.#logger.warn("fairlight.monitor_incomplete", { monitor: index });
          continue;
        }
        next.set(index, {
          state: {
            index,
            name: monitorName(loaded, nameNode, index),
            levelDb: levelNode ? readNumber(levelNode.contents.value) : null,
            muted: muteNode ? readBoolean(muteNode.contents.value) : null,
            dimmed: dimNode ? readBoolean(dimNode.contents.value) : null,
            writableLevel: levelNode !== null && isWritable(levelNode),
            writableMute: muteNode !== null && isWritable(muteNode),
            writableDim: dimNode !== null && isWritable(dimNode),
          },
          node: loaded,
          levelNode,
          muteNode,
          nameNode,
          dimNode,
        });
      } catch (error) {
        this.#logger.warn("fairlight.monitor_discovery_failed", { monitor: index, error });
      }
      this.#assertSession(session);
    }
    return next;
  }

  async #discoverOnAir(roots: EmberNodeLike[], session: number): Promise<void> {
    const systemRoot = findSystemRoot(roots);
    if (!systemRoot) {
      this.#onAirNode = null;
      this.#applyOnAir(null);
      return;
    }
    let systemContainer: EmberNodeLike;
    try {
      systemContainer = await this.#loadNode(systemRoot, session);
    } catch (error) {
      this.#logger.warn("fairlight.system_root_failed", { error });
      this.#onAirNode = null;
      this.#applyOnAir(null);
      return;
    }
    const node = findOnAirParameter(systemContainer);
    this.#onAirNode = node;
    this.#applyOnAir(node ? readBoolean(node.contents.value) : null);
  }

  async #performDiscoverInner(session: number, initial: boolean): Promise<void> {
    const client = this.#requireClient();
    const previous = this.#lastSnapshot;
    const revalidate = this.#structureDetected;
    const epoch = this.#structureEpoch;

    const rootRequest = await client.getDirectory(client.tree);
    if (!rootRequest.sentOk) throw new FairlightError("EMBER_ROOT_FAILED", "Fairlight did not accept the root directory request");
    if (rootRequest.response) await rootRequest.response;
    this.#assertSession(session);

    const roots = collectionValues(client.tree);
    const channelRoot = roots.find((root) => isParameterLikeRoot(root) && rootMatches(root, "channel"));
    if (!channelRoot) {
      throw new FairlightError("CHANNEL_ROOT_NOT_FOUND", "Fairlight Ember+ tree has no channel root");
    }

    this.#assertSession(session);
    await this.#discoverOnAir(roots, session);

    const channelContainer = await this.#loadNode(channelRoot, session);
    const channelNodes = childNodes(channelContainer)
      .filter((node) => node.contents.type === Model.ElementType.Node)
      .filter((node) => node.contents.isOnline !== false)
      .filter((node) => (node.number ?? 0) > 0)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

    const nextChannels = new Map<number, ChannelEntry>();
    for (const stripNode of channelNodes) {
      const index = stripNode.number ?? 0;
      try {
        const loaded = await this.#loadNode(stripNode, session);
        const paramsParent = hasChildren(loaded) ? loaded : stripNode;
        const levelNode = findParameter(paramsParent, "level");
        const muteNode = findParameter(paramsParent, "mute");
        const nameNode = findParameter(paramsParent, "name");
        const panNode = findParameter(paramsParent, "pan");
        const meterNode = findMeterParameter(paramsParent);
        const sendEntries = await this.#discoverAuxSends(paramsParent, session);
        if (!levelNode && !muteNode && !nameNode) {
          this.#logger.warn("fairlight.channel_incomplete", { channel: index });
          continue;
        }
        const sends: Record<string, SendState> = {};
        for (const [key, entry] of sendEntries) sends[key] = entry.state;
        const state: ChannelState = {
          index,
          name: channelName(loaded, nameNode, index),
          levelDb: levelNode ? readNumber(levelNode.contents.value) : null,
          muted: muteNode ? readBoolean(muteNode.contents.value) : null,
          pan: panNode ? readNumber(panNode.contents.value) : null,
          meterDb: meterNode ? readNumber(meterNode.contents.value) : null,
          sends,
          writableLevel: levelNode !== null && isWritable(levelNode),
          writableMute: muteNode !== null && isWritable(muteNode),
          writablePan: panNode !== null && isWritable(panNode),
        };
        nextChannels.set(index, {
          state,
          node: loaded,
          levelNode,
          muteNode,
          nameNode,
          panNode,
          meterNode,
          sends: sendEntries,
        });
      } catch (error) {
        this.#logger.warn("fairlight.channel_discovery_failed", { channel: index, error });
      }
      this.#assertSession(session);
    }

    const nextBuses = new Map<string, BusEntry>();
    for (const type of BUS_TYPES) {
      const busRoot = roots.find((root) => isParameterLikeRoot(root) && busRootMatches(root, type));
      if (!busRoot) continue;
      let busContainer: EmberNodeLike;
      try {
        busContainer = await this.#loadNode(busRoot, session);
      } catch (error) {
        this.#logger.warn("fairlight.bus_root_failed", { type, error });
        continue;
      }
      const busNodes = childNodes(busContainer)
        .filter((node) => node.contents.type === Model.ElementType.Node)
        .filter((node) => node.contents.isOnline !== false)
        .filter((node) => (node.number ?? 0) > 0)
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
      for (const busNode of busNodes) {
        const index = busNode.number ?? 0;
        try {
          const loaded = await this.#loadNode(busNode, session);
          const paramsParent = hasChildren(loaded) ? loaded : busNode;
          // A `meters` container is a nested node whose parameters only appear
          // after its own directory request.
          const metersNode = findNode(paramsParent, "meters");
          if (metersNode) {
            try {
              await this.#loadNode(metersNode, session);
            } catch (error) {
              this.#logger.warn("fairlight.bus_meters_failed", { type, bus: index, error });
            }
          }
          const levelNode = findParameter(paramsParent, "level");
          const muteNode = findParameter(paramsParent, "mute");
          const nameNode = findParameter(paramsParent, "name");
          const panNode = findParameter(paramsParent, "pan");
          const meterNode = findMeterParameter(paramsParent);
          const integratedNode = findMetersParameter(paramsParent, "integrated");
          const state: BusState = {
            type,
            index,
            name: busName(loaded, nameNode, type, index),
            levelDb: levelNode ? readNumber(levelNode.contents.value) : null,
            muted: muteNode ? readBoolean(muteNode.contents.value) : null,
            pan: panNode ? readNumber(panNode.contents.value) : null,
            meterDb: meterNode ? readNumber(meterNode.contents.value) : null,
            integratedLufs: integratedNode ? readNumber(integratedNode.contents.value) : null,
            writableLevel: levelNode !== null && isWritable(levelNode),
            writableMute: muteNode !== null && isWritable(muteNode),
            writablePan: panNode !== null && isWritable(panNode),
          };
          nextBuses.set(busKey(type, index), {
            state,
            node: loaded,
            levelNode,
            muteNode,
            nameNode,
            panNode,
            meterNode,
            integratedNode,
          });
        } catch (error) {
          this.#logger.warn("fairlight.bus_discovery_failed", { type, bus: index, error });
        }
        this.#assertSession(session);
      }
    }

    this.#assertSession(session);
    this.#channels = nextChannels;
    this.#buses = nextBuses;
    this.#monitors = await this.#discoverMonitors(roots, session);
    this.#revision += 1;
    const snapshot = this.snapshot();
    this.#lastSnapshot = snapshot;

    const summary = diffSnapshots(previous, snapshot);
    const changed = hasStructureChanges(summary);
    if (changed && previous !== null) {
      this.#logger.warn("fairlight.structure_changed", { summary });
      this.#emit({ type: "structure-changed", summary });
    }

    await this.#subscribeAll(client, session);
    this.#assertSession(session);
    this.#logger.info("fairlight.discovered", {
      channels: snapshot.channels.length,
      buses: snapshot.buses.length,
      monitors: snapshot.monitors.length,
      writableChannels: snapshot.channels.filter((channel) => channel.writableLevel && channel.writableMute).length,
    });
    if (!initial) this.#emit({ type: "snapshot", snapshot });

    if (revalidate && epoch === this.#structureEpoch) {
      this.#structureDetected = false;
      this.#structureReason = null;
      if (!changed) {
        this.#logger.info("fairlight.structure_revalidated");
        this.#emit({ type: "structure-revalidated" });
      }
    }
  }

  async #subscribeAll(client: EmberClient, session: number): Promise<void> {
    for (const root of collectionValues(client.tree)) {
      if (!isParameterLikeRoot(root)) continue;
      const identifier = rootMatches(root, "channel")
        ? "channel"
        : BUS_TYPES.find((type) => busRootMatches(root, type));
      if (!identifier) continue;
      await this.#subscribe(
        client,
        `root:${identifier}`,
        root,
        () => this.#scheduleStructureRefresh(`root update: ${identifier}`),
        session,
        `root:${identifier}`,
      );
    }

    if (this.#onAirNode) {
      await this.#subscribe(
        client,
        "param:system:onair",
        this.#onAirNode,
        () => this.#refreshOnAir(),
        session,
        "param:system:onair",
      );
    }

    for (const [index, entry] of this.#channels) {
      await this.#subscribeParameter(client, session, index, "level", entry.levelNode);
      await this.#subscribeParameter(client, session, index, "mute", entry.muteNode);
      await this.#subscribeParameter(client, session, index, "pan", entry.panNode);
      if (this.#options.subscribeMeters) {
        await this.#subscribeMeterParameter(client, session, index, entry.meterNode);
      }
      if (this.#options.watchChannelNames?.includes(index)) {
        await this.#subscribeParameter(client, session, index, "name", entry.nameNode);
      }
      for (const send of entry.sends.values()) {
        const aux = send.state.index;
        await this.#subscribe(
          client,
          `param:channel:${index}:send:aux:${aux}:level`,
          send.levelNode ?? entry.node,
          () => this.#refreshChannelSendFromEntry(index, aux),
          session,
          `param:channel:${index}:send:aux:${aux}:level`,
        );
      }
      await this.#subscribe(
        client,
        `strip:${index}`,
        entry.node,
        () => this.#refreshChannelFromEntry(index),
        session,
        `strip:${index}`,
      );
    }

    for (const entry of this.#buses.values()) {
      const key = busKey(entry.state.type, entry.state.index);
      await this.#subscribeBusParameter(client, session, entry.state.type, entry.state.index, "level", entry.levelNode);
      await this.#subscribeBusParameter(client, session, entry.state.type, entry.state.index, "mute", entry.muteNode);
      await this.#subscribeBusParameter(client, session, entry.state.type, entry.state.index, "pan", entry.panNode);
      if (this.#options.subscribeMeters) {
        await this.#subscribeBusMeterParameter(
          client,
          session,
          entry.state.type,
          entry.state.index,
          "meter",
          entry.meterNode,
        );
        await this.#subscribeBusMeterParameter(
          client,
          session,
          entry.state.type,
          entry.state.index,
          "integrated",
          entry.integratedNode,
        );
      }
      await this.#subscribe(
        client,
        `bus:${key}`,
        entry.node,
        () => this.#refreshBusFromEntry(entry.state.type, entry.state.index),
        session,
        `bus:${key}`,
      );
    }

    const watchedMonitors = new Set(this.#options.watchMonitors ?? []);
    for (const entry of this.#monitors.values()) {
      if (watchedMonitors.has(entry.state.index)) {
        await this.#subscribeMonitorParameter(client, session, entry.state.index, "dim", entry.dimNode);
      }
    }
  }

  async #subscribeParameter(
    client: EmberClient,
    session: number,
    index: number,
    field: "level" | "mute" | "name" | "pan",
    node: EmberNodeLike | null,
  ): Promise<void> {
    if (!node) return;
    await this.#subscribe(
      client,
      `param:channel:${index}:${field}`,
      node,
      () => this.#refreshChannelField(index, field),
      session,
      `param:channel:${index}:${field}`,
    );
  }

  async #subscribeMeterParameter(
    client: EmberClient,
    session: number,
    index: number,
    node: EmberNodeLike | null,
  ): Promise<void> {
    if (!node) return;
    await this.#subscribe(
      client,
      `param:channel:${index}:meter`,
      node,
      () => this.#refreshChannelField(index, "meter"),
      session,
      `param:channel:${index}:meter`,
    );
  }

  async #subscribeBusParameter(
    client: EmberClient,
    session: number,
    type: BusType,
    index: number,
    field: "level" | "mute" | "pan",
    node: EmberNodeLike | null,
  ): Promise<void> {
    if (!node) return;
    const key = busKey(type, index);
    await this.#subscribe(
      client,
      `param:bus:${key}:${field}`,
      node,
      () => this.#refreshBusField(type, index, field),
      session,
      `param:bus:${key}:${field}`,
    );
  }

  async #subscribeBusMeterParameter(
    client: EmberClient,
    session: number,
    type: BusType,
    index: number,
    field: "meter" | "integrated",
    node: EmberNodeLike | null,
  ): Promise<void> {
    if (!node) return;
    const key = busKey(type, index);
    await this.#subscribe(
      client,
      `param:bus:${key}:${field}`,
      node,
      () => this.#refreshBusField(type, index, field),
      session,
      `param:bus:${key}:${field}`,
    );
  }

  async #subscribeMonitorParameter(
    client: EmberClient,
    session: number,
    index: number,
    field: "dim",
    node: EmberNodeLike | null,
  ): Promise<void> {
    if (!node) return;
    await this.#subscribe(
      client,
      `param:monitor:${index}:${field}`,
      node,
      () => this.#refreshMonitorField(index, field),
      session,
      `param:monitor:${index}:${field}`,
    );
  }

  #refreshChannelField(index: number, field: ChannelField): void {
    const entry = this.#channels.get(index);
    if (!entry) return;
    if (entry.node.contents.isOnline === false) {
      this.#scheduleStructureRefresh(`channel ${index} offline`);
      return;
    }
    if (field === "level" && entry.levelNode) {
      const level = readNumber(entry.levelNode.contents.value);
      if (level !== null) this.#applyChannelField(entry, "level", level, true);
    } else if (field === "mute" && entry.muteNode) {
      const muted = readBoolean(entry.muteNode.contents.value);
      if (muted !== null) this.#applyChannelField(entry, "mute", muted, true);
    } else if (field === "name" && entry.nameNode) {
      const name = readString(entry.nameNode.contents.value);
      if (name !== null) this.#applyChannelField(entry, "name", name, true);
    } else if (field === "pan" && entry.panNode) {
      const pan = readNumber(entry.panNode.contents.value);
      if (pan !== null) this.#applyChannelField(entry, "pan", pan, true);
    } else if (field === "meter" && entry.meterNode) {
      const meter = readNumber(entry.meterNode.contents.value);
      if (meter !== null) this.#applyChannelField(entry, "meter", meter, true);
    }
  }

  #refreshChannelFromEntry(index: number): void {
    const entry = this.#channels.get(index);
    if (!entry) return;
    if (entry.node.contents.isOnline === false) {
      this.#scheduleStructureRefresh(`channel ${index} offline`);
      return;
    }
    if (entry.levelNode) {
      const level = readNumber(entry.levelNode.contents.value);
      if (level !== null) this.#applyChannelField(entry, "level", level, true);
    }
    if (entry.muteNode) {
      const muted = readBoolean(entry.muteNode.contents.value);
      if (muted !== null) this.#applyChannelField(entry, "mute", muted, true);
    }
    if (entry.nameNode) {
      const name = readString(entry.nameNode.contents.value);
      if (name !== null) this.#applyChannelField(entry, "name", name, true);
    }
    if (entry.panNode) {
      const pan = readNumber(entry.panNode.contents.value);
      if (pan !== null) this.#applyChannelField(entry, "pan", pan, true);
    }
    if (entry.meterNode) {
      const meter = readNumber(entry.meterNode.contents.value);
      if (meter !== null) this.#applyChannelField(entry, "meter", meter, true);
    }
    for (const send of entry.sends.values()) {
      const level = send.levelNode ? readNumber(send.levelNode.contents.value) : null;
      if (level !== null) this.#applyChannelSendLevel(entry, send, level, true);
    }
  }

  #refreshChannelSendFromEntry(index: number, auxIndex: number): void {
    const entry = this.#channels.get(index);
    if (!entry) return;
    if (entry.node.contents.isOnline === false) {
      this.#scheduleStructureRefresh(`channel ${index} offline`);
      return;
    }
    const send = entry.sends.get(auxSendKey(auxIndex));
    if (!send?.levelNode) return;
    const level = readNumber(send.levelNode.contents.value);
    if (level !== null) this.#applyChannelSendLevel(entry, send, level, true);
  }

  #applyChannelSendLevel(entry: ChannelEntry, send: SendEntry, level: number, fromProvider: boolean): void {
    if (send.state.levelDb === level) return;
    send.state.levelDb = level;
    entry.state.sends[auxSendKey(send.state.index)] = { ...send.state };
    this.#revision += 1;
    this.#logger.debug("fairlight.channel_send_updated", {
      channel: entry.state.index,
      aux: send.state.index,
      level,
      source: fromProvider ? "provider" : "write",
    });
    this.#emit({ type: "channel", channel: cloneChannel(entry.state), changed: ["send"] });
  }

  #refreshBusField(type: BusType, index: number, field: BusField): void {
    const entry = this.#buses.get(busKey(type, index));
    if (!entry) return;
    if (entry.node.contents.isOnline === false) {
      this.#scheduleStructureRefresh(`bus ${type}:${index} offline`);
      return;
    }
    if (field === "level" && entry.levelNode) {
      const level = readNumber(entry.levelNode.contents.value);
      if (level !== null) this.#applyBusField(entry, "level", level, true);
    } else if (field === "mute" && entry.muteNode) {
      const muted = readBoolean(entry.muteNode.contents.value);
      if (muted !== null) this.#applyBusField(entry, "mute", muted, true);
    } else if (field === "pan" && entry.panNode) {
      const pan = readNumber(entry.panNode.contents.value);
      if (pan !== null) this.#applyBusField(entry, "pan", pan, true);
    } else if (field === "meter" && entry.meterNode) {
      const meter = readNumber(entry.meterNode.contents.value);
      if (meter !== null) this.#applyBusField(entry, "meter", meter, true);
    } else if (field === "integrated" && entry.integratedNode) {
      const integrated = readNumber(entry.integratedNode.contents.value);
      if (integrated !== null) this.#applyBusField(entry, "integrated", integrated, true);
    }
  }

  #refreshBusFromEntry(type: BusType, index: number): void {
    const entry = this.#buses.get(busKey(type, index));
    if (!entry) return;
    if (entry.node.contents.isOnline === false) {
      this.#scheduleStructureRefresh(`bus ${type}:${index} offline`);
      return;
    }
    if (entry.levelNode) {
      const level = readNumber(entry.levelNode.contents.value);
      if (level !== null) this.#applyBusField(entry, "level", level, true);
    }
    if (entry.muteNode) {
      const muted = readBoolean(entry.muteNode.contents.value);
      if (muted !== null) this.#applyBusField(entry, "mute", muted, true);
    }
    if (entry.panNode) {
      const pan = readNumber(entry.panNode.contents.value);
      if (pan !== null) this.#applyBusField(entry, "pan", pan, true);
    }
    if (entry.meterNode) {
      const meter = readNumber(entry.meterNode.contents.value);
      if (meter !== null) this.#applyBusField(entry, "meter", meter, true);
    }
    if (entry.integratedNode) {
      const integrated = readNumber(entry.integratedNode.contents.value);
      if (integrated !== null) this.#applyBusField(entry, "integrated", integrated, true);
    }
  }

  #refreshMonitorField(index: number, field: MonitorField): void {
    const entry = this.#monitors.get(index);
    if (!entry) return;
    if (entry.node.contents.isOnline === false) {
      this.#scheduleStructureRefresh(`monitor ${index} offline`);
      return;
    }
    if (field === "level" && entry.levelNode) {
      const level = readNumber(entry.levelNode.contents.value);
      if (level !== null) this.#applyMonitorField(entry, "level", level, true);
    } else if (field === "mute" && entry.muteNode) {
      const muted = readBoolean(entry.muteNode.contents.value);
      if (muted !== null) this.#applyMonitorField(entry, "mute", muted, true);
    } else if (field === "dim" && entry.dimNode) {
      const dimmed = readBoolean(entry.dimNode.contents.value);
      if (dimmed !== null) this.#applyMonitorField(entry, "dim", dimmed, true);
    }
  }

  #refreshOnAir(): void {
    if (!this.#onAirNode) return;
    this.#applyOnAir(readBoolean(this.#onAirNode.contents.value));
  }

  async #subscribe(
    client: EmberClient,
    key: string,
    node: EmberNodeLike,
    callback: () => void,
    session: number,
    label: string,
  ): Promise<void> {
    if (this.#subscriptionKeys.has(key)) {
      try {
        const refreshed = await client.subscribe(node as unknown as SubscribeArg);
        if (!refreshed.sentOk) {
          this.#logger.warn("fairlight.subscription_refresh_failed", { node: label, reason: "request not sent" });
        }
      } catch (error) {
        this.#logger.warn("fairlight.subscription_refresh_failed", { node: label, error });
      }
      return;
    }
    try {
      const request = await client.subscribe(node as unknown as SubscribeArg, () => {
        if (session !== this.#session || this.#client !== client) return;
        callback();
      });
      if (!request.sentOk) {
        this.#logger.warn("fairlight.subscription_failed", { node: label, reason: "request not sent" });
        return;
      }
      this.#subscriptionKeys.add(key);
    } catch (error) {
      this.#logger.warn("fairlight.subscription_failed", { node: label, error });
    }
  }

  #applyOnAir(value: boolean | null): void {
    if (this.#onAir === value) return;
    this.#onAir = value;
    this.#revision += 1;
    this.#logger.debug("fairlight.on_air_updated", { onAir: value });
    this.#emit({ type: "system", onAir: value });
  }

  #applyChannelField(entry: ChannelEntry, field: ChannelField, value: number | boolean | string, fromProvider: boolean): void {
    let changed = false;
    switch (field) {
      case "level":
        if (typeof value === "number" && entry.state.levelDb !== value) {
          entry.state.levelDb = value;
          changed = true;
        }
        break;
      case "mute":
        if (typeof value === "boolean" && entry.state.muted !== value) {
          entry.state.muted = value;
          changed = true;
        }
        break;
      case "name":
        if (typeof value === "string" && entry.state.name !== value) {
          entry.state.name = value;
          changed = true;
        }
        break;
      case "pan":
        if (typeof value === "number" && entry.state.pan !== value) {
          entry.state.pan = value;
          changed = true;
        }
        break;
      case "meter":
        if (typeof value === "number" && entry.state.meterDb !== value) {
          entry.state.meterDb = value;
          changed = true;
        }
        break;
    }
    if (!changed) return;
    this.#revision += 1;
    this.#logger.debug("fairlight.channel_updated", {
      channel: entry.state.index,
      field,
      value,
      source: fromProvider ? "provider" : "write",
    });
    this.#emit({ type: "channel", channel: cloneChannel(entry.state), changed: [field] });
  }

  #applyBusField(entry: BusEntry, field: BusField, value: number | boolean, fromProvider: boolean): void {
    let changed = false;
    switch (field) {
      case "level":
        if (typeof value === "number" && entry.state.levelDb !== value) {
          entry.state.levelDb = value;
          changed = true;
        }
        break;
      case "mute":
        if (typeof value === "boolean" && entry.state.muted !== value) {
          entry.state.muted = value;
          changed = true;
        }
        break;
      case "name":
        break;
      case "pan":
        if (typeof value === "number" && entry.state.pan !== value) {
          entry.state.pan = value;
          changed = true;
        }
        break;
      case "meter":
        if (typeof value === "number" && entry.state.meterDb !== value) {
          entry.state.meterDb = value;
          changed = true;
        }
        break;
      case "integrated":
        if (typeof value === "number" && entry.state.integratedLufs !== value) {
          entry.state.integratedLufs = value;
          changed = true;
        }
        break;
    }
    if (!changed) return;
    this.#revision += 1;
    this.#emit({ type: "bus", bus: cloneBus(entry.state), changed: [field] });
    this.#logger.debug("fairlight.bus_updated", {
      bus: busKey(entry.state.type, entry.state.index),
      field,
      value,
      source: fromProvider ? "provider" : "write",
    });
  }

  #applyMonitorField(
    entry: MonitorEntry,
    field: MonitorField,
    value: number | boolean | string,
    fromProvider: boolean,
  ): void {
    let changed = false;
    switch (field) {
      case "level":
        if (typeof value === "number" && entry.state.levelDb !== value) {
          entry.state.levelDb = value;
          changed = true;
        }
        break;
      case "mute":
        if (typeof value === "boolean" && entry.state.muted !== value) {
          entry.state.muted = value;
          changed = true;
        }
        break;
      case "dim":
        if (typeof value === "boolean" && entry.state.dimmed !== value) {
          entry.state.dimmed = value;
          changed = true;
        }
        break;
      case "name":
        if (typeof value === "string" && entry.state.name !== value) {
          entry.state.name = value;
          changed = true;
        }
        break;
    }
    if (!changed) return;
    this.#revision += 1;
    this.#emit({ type: "monitor", monitor: cloneMonitor(entry.state), changed: [field] });
    this.#logger.debug("fairlight.monitor_updated", {
      monitor: entry.state.index,
      field,
      value,
      source: fromProvider ? "provider" : "write",
    });
  }

  async #writeParameter(node: EmberNodeLike, value: number | boolean, field: string): Promise<unknown> {
    const client = this.#requireClient();
    if (!this.#connected) throw new FairlightError("FAIRLIGHT_OFFLINE", "Fairlight is not connected");
    let request: Awaited<ReturnType<EmberClient["setValue"]>>;
    try {
      request = await client.setValue(node as unknown as SetValueArg, value, true);
    } catch (error) {
      throw new FairlightError("WRITE_FAILED", `Fairlight rejected the ${field} write`, { field }, { cause: error });
    }
    if (!request.sentOk) {
      throw new FairlightError("WRITE_FAILED", `Fairlight did not accept the ${field} write`, { field });
    }
    try {
      const response = await request.response;
      if (!response) throw new Error("No response");
      return response.contents.value;
    } catch (error) {
      throw new FairlightError("WRITE_UNCONFIRMED", `Fairlight did not confirm the ${field} write`, { field }, { cause: error });
    }
  }

  async #loadNode(node: EmberNodeLike, session: number): Promise<EmberNodeLike> {
    if (hasChildren(node)) return node;
    const client = this.#requireClient();
    const request = await client.getDirectory(node as unknown as DirectoryArg);
    this.#assertSession(session);
    if (!request.sentOk) {
      throw new FairlightError("EMBER_DIRECTORY_FAILED", `Fairlight did not accept a directory request for ${nodeLabel(node)}`);
    }
    if (!request.response) return node;
    const response = (await request.response) as unknown as EmberNodeLike;
    this.#assertSession(session);
    return response;
  }

  #requireClient(): EmberClient {
    if (!this.#client) throw new FairlightError("FAIRLIGHT_OFFLINE", "Fairlight is not connected");
    return this.#client;
  }

  #assertSession(session: number): void {
    if (session !== this.#session || this.#stopped) {
      throw new FairlightError("SESSION_CHANGED", "Fairlight connection changed during discovery");
    }
  }

  #scheduleStructureRefresh(reason: string): void {
    if (this.#stopped || !this.#connected || this.#discoveryDepth > 0) return;
    this.#structureEpoch += 1;
    if (!this.#structureDetected) {
      this.#structureDetected = true;
      this.#structureReason = reason;
      this.#logger.warn("fairlight.structure_change_detected", { reason });
      this.#emit({ type: "structure-change-detected", reason });
    }
    if (this.#refreshTimer) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined;
      const session = this.#session;
      if (!this.#connected) return;
      this.#discover(session, false).catch((error) => {
        this.#logger.warn("fairlight.structure_refresh_failed", {
          reason: this.#structureReason,
          error,
        });
      });
    }, 250);
  }

  #emit(event: FairlightEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.#logger.error("fairlight.listener_failed", { error });
      }
    }
  }
}

function isParameterLikeRoot(node: EmberNodeLike): boolean {
  return node.contents.type === Model.ElementType.Node;
}
