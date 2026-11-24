import type { BusType } from "../config.js";
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

export interface MockBusSpec {
  type: BusType;
  index: number;
  name?: string;
  levelDb?: number;
  muted?: boolean;
  pan?: number | null;
  meterDb?: number;
  /** Integrated loudness in LUFS; usually only main buses provide it. */
  integratedLufs?: number | null;
  writableLevel?: boolean;
  writableMute?: boolean;
  writablePan?: boolean;
}

export interface MockAuxSendSpec {
  index: number;
  levelDb?: number;
  muted?: boolean;
  pan?: number | null;
  writableLevel?: boolean;
  writableMute?: boolean;
  writablePan?: boolean;
}

export interface MockMonitorSpec {
  index: number;
  name?: string;
  levelDb?: number;
  muted?: boolean;
  dimmed?: boolean;
  writableLevel?: boolean;
  writableMute?: boolean;
  writableDim?: boolean;
}

export interface MockFairlightOptions {
  channelCount?: number;
  busCount?: number;
  buses?: MockBusSpec[];
  auxSends?: MockAuxSendSpec[];
  monitors?: MockMonitorSpec[];
  latencyMs?: number;
  logger?: Logger;
  /** Simulated Fairlight on-air state. Defaults to false; null means unknown. */
  onAir?: boolean | null;
}

export interface MockWrite {
  at: number;
  kind:
    | "channel-level"
    | "channel-mute"
    | "channel-pan"
    | "channel-send-level"
    | "bus-level"
    | "bus-mute"
    | "bus-pan"
    | "monitor-dim";
  target: string;
  value: number | boolean;
}

function makeAuxSend(spec: MockAuxSendSpec): SendState {
  return {
    type: "aux",
    index: spec.index,
    levelDb: spec.levelDb ?? -12,
    muted: spec.muted ?? false,
    pan: spec.pan ?? null,
    writableLevel: spec.writableLevel ?? true,
    writableMute: spec.writableMute ?? true,
    writablePan: spec.writablePan ?? typeof spec.pan === "number",
  };
}

let revision = 0;

export class MockFairlightClient implements FairlightClient {
  #connected = false;
  #channels = new Map<number, ChannelState>();
  #buses = new Map<string, BusState>();
  #monitors = new Map<number, MonitorState>();
  #listeners = new Set<FairlightEventListener>();
  #onAir: boolean | null;
  #latencyMs: number;
  #logger: Logger | undefined;
  #pendingFailure: Error | null = null;
  readonly writes: MockWrite[] = [];

  constructor(options: MockFairlightOptions = {}) {
    this.#latencyMs = options.latencyMs ?? 0;
    this.#logger = options.logger;
    this.#onAir = options.onAir === undefined ? false : options.onAir;
    const channelCount = options.channelCount ?? 24;
    for (let index = 1; index <= channelCount; index += 1) {
      const sends: Record<string, SendState> = {};
      for (const spec of options.auxSends ?? []) {
        sends[auxSendKey(spec.index)] = makeAuxSend(spec);
      }
      this.#channels.set(index, {
        index,
        name: `CH ${String(index).padStart(2, "0")}`,
        levelDb: -12 + ((index - 1) % 6),
        muted: false,
        pan: 0,
        meterDb: -60,
        sends,
        writableLevel: true,
        writableMute: true,
        writablePan: true,
      });
    }
    const busCount = options.busCount ?? 1;
    if (options.buses) {
      for (const spec of options.buses) {
        this.#buses.set(busKey(spec.type, spec.index), {
          type: spec.type,
          index: spec.index,
          name: spec.name ?? `${spec.type} ${spec.index}`,
          levelDb: spec.levelDb ?? -6,
          muted: spec.muted ?? false,
          pan: spec.pan ?? null,
          meterDb: spec.meterDb ?? -60,
          integratedLufs: spec.integratedLufs ?? null,
          writableLevel: spec.writableLevel ?? true,
          writableMute: spec.writableMute ?? true,
          writablePan: spec.writablePan ?? typeof spec.pan === "number",
        });
      }
    } else {
      for (let index = 1; index <= busCount; index += 1) {
        this.#buses.set(busKey("main", index), {
          type: "main",
          index,
          name: index === 1 ? "Main" : `Main ${index}`,
          levelDb: -6,
          muted: false,
          pan: null,
          meterDb: -60,
          integratedLufs: null,
          writableLevel: true,
          writableMute: true,
          writablePan: false,
        });
      }
    }
    const monitorSpecs = options.monitors ?? [
      { index: 1, name: "Monitor 1" },
      { index: 2, name: "Monitor 2" },
      { index: 3, name: "Monitor 3" },
      { index: 4, name: "Monitor 4" },
    ];
    for (const spec of monitorSpecs) {
      this.#monitors.set(spec.index, {
        index: spec.index,
        name: spec.name ?? `Monitor ${spec.index}`,
        levelDb: spec.levelDb ?? -6,
        muted: spec.muted ?? false,
        dimmed: spec.dimmed ?? false,
        writableLevel: spec.writableLevel ?? true,
        writableMute: spec.writableMute ?? true,
        writableDim: spec.writableDim ?? true,
      });
    }
  }

  get connected(): boolean {
    return this.#connected;
  }

  onEvent(listener: FairlightEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.#connected = true;
    const snapshot = this.snapshot();
    this.#emit({ type: "connected", snapshot });
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#emit({ type: "disconnected", reason: "mock disconnect" });
  }

  snapshot(): FairlightSnapshot {
    revision += 1;
    return {
      revision,
      discoveredAt: new Date().toISOString(),
      onAir: this.#onAir,
      channels: [...this.#channels.values()].sort((a, b) => a.index - b.index).map(cloneChannel),
      buses: [...this.#buses.values()].sort((a, b) =>
        a.type === b.type ? a.index - b.index : a.type.localeCompare(b.type),
      ).map(cloneBus),
      monitors: [...this.#monitors.values()].sort((a, b) => a.index - b.index).map(cloneMonitor),
    };
  }

  async setChannelLevel(index: number, db: number): Promise<number> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const channel = this.#channels.get(index);
    if (!channel) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} does not exist`);
    if (!channel.writableLevel) throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} level is read-only`);
    channel.levelDb = db;
    this.writes.push({ at: Date.now(), kind: "channel-level", target: String(index), value: db });
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["level"] });
    this.#logger?.debug("fairlight.mock.level_set", { channel: index, db });
    return db;
  }

  async setChannelMute(index: number, muted: boolean): Promise<boolean> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const channel = this.#channels.get(index);
    if (!channel) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} does not exist`);
    if (!channel.writableMute) throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} mute is read-only`);
    channel.muted = muted;
    this.writes.push({ at: Date.now(), kind: "channel-mute", target: String(index), value: muted });
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["mute"] });
    return muted;
  }

  async setChannelPan(index: number, pan: number): Promise<number> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const channel = this.#channels.get(index);
    if (!channel) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} does not exist`);
    if (!channel.writablePan) throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} pan is read-only`);
    const value = Math.min(100, Math.max(-100, Math.round(pan)));
    channel.pan = value;
    this.writes.push({ at: Date.now(), kind: "channel-pan", target: String(index), value });
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["pan"] });
    this.#logger?.debug("fairlight.mock.pan_set", { channel: index, pan: value });
    return value;
  }

  async setChannelSendLevel(index: number, auxIndex: number, db: number): Promise<number> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const channel = this.#channels.get(index);
    if (!channel) throw new FairlightError("CHANNEL_NOT_FOUND", `Fairlight channel ${index} does not exist`);
    const send = channel.sends[auxSendKey(auxIndex)];
    if (!send) throw new FairlightError("SEND_NOT_FOUND", `Fairlight channel ${index} has no aux ${auxIndex} send`);
    if (!send.writableLevel) {
      throw new FairlightError("CHANNEL_READ_ONLY", `Fairlight channel ${index} aux ${auxIndex} send is read-only`);
    }
    const value = Math.min(10, Math.max(-100, Number(db.toFixed(1))));
    send.levelDb = value;
    this.writes.push({ at: Date.now(), kind: "channel-send-level", target: `${index}:aux:${auxIndex}`, value });
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["send"] });
    this.#logger?.debug("fairlight.mock.send_level_set", { channel: index, aux: auxIndex, db: value });
    return value;
  }

  async setBusLevel(type: BusType, index: number, db: number): Promise<number> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const bus = this.#buses.get(busKey(type, index));
    if (!bus) throw new FairlightError("BUS_NOT_FOUND", `Fairlight bus ${type}:${index} does not exist`);
    if (!bus.writableLevel) throw new FairlightError("BUS_READ_ONLY", `Fairlight bus ${type}:${index} level is read-only`);
    bus.levelDb = db;
    this.writes.push({ at: Date.now(), kind: "bus-level", target: busKey(type, index), value: db });
    this.#emit({ type: "bus", bus: cloneBus(bus), changed: ["level"] });
    return db;
  }

  async setBusMute(type: BusType, index: number, muted: boolean): Promise<boolean> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const bus = this.#buses.get(busKey(type, index));
    if (!bus) throw new FairlightError("BUS_NOT_FOUND", `Fairlight bus ${type}:${index} does not exist`);
    if (!bus.writableMute) throw new FairlightError("BUS_READ_ONLY", `Fairlight bus ${type}:${index} mute is read-only`);
    bus.muted = muted;
    this.writes.push({ at: Date.now(), kind: "bus-mute", target: busKey(type, index), value: muted });
    this.#emit({ type: "bus", bus: cloneBus(bus), changed: ["mute"] });
    return muted;
  }

  async setBusPan(type: BusType, index: number, pan: number): Promise<number> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const bus = this.#buses.get(busKey(type, index));
    if (!bus) throw new FairlightError("BUS_NOT_FOUND", `Fairlight bus ${type}:${index} does not exist`);
    if (!bus.writablePan) throw new FairlightError("BUS_READ_ONLY", `Fairlight bus ${type}:${index} pan is read-only`);
    const value = Math.min(100, Math.max(-100, Math.round(pan)));
    bus.pan = value;
    this.writes.push({ at: Date.now(), kind: "bus-pan", target: busKey(type, index), value });
    this.#emit({ type: "bus", bus: cloneBus(bus), changed: ["pan"] });
    return value;
  }

  async setMonitorDim(index: number, dimmed: boolean): Promise<boolean> {
    this.#checkConnected();
    await this.#delay();
    this.#throwInjectedFailure();
    const monitor = this.#monitors.get(index);
    if (!monitor) throw new FairlightError("MONITOR_NOT_FOUND", `Fairlight monitor ${index} does not exist`);
    if (!monitor.writableDim) throw new FairlightError("MONITOR_READ_ONLY", `Fairlight monitor ${index} dim is read-only`);
    monitor.dimmed = dimmed;
    this.writes.push({ at: Date.now(), kind: "monitor-dim", target: `monitor:${index}`, value: dimmed });
    this.#emit({ type: "monitor", monitor: cloneMonitor(monitor), changed: ["dim"] });
    this.#logger?.debug("fairlight.mock.monitor_dim_set", { monitor: index, dimmed });
    return dimmed;
  }

  addChannel(index: number, name: string, levelDb = 0): void {
    if (this.#channels.has(index)) return;
    this.#channels.set(index, {
      index,
      name,
      levelDb,
      muted: false,
      pan: 0,
      meterDb: -60,
      sends: {},
      writableLevel: true,
      writableMute: true,
      writablePan: true,
    });
  }

  /** Removes a bus and publishes a fresh snapshot, like a structure change. */
  removeBus(type: BusType, index: number): void {
    if (!this.#buses.delete(busKey(type, index))) return;
    this.#emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  addAuxSend(channelIndex: number, spec: MockAuxSendSpec): void {
    const channel = this.#channels.get(channelIndex);
    if (!channel) return;
    channel.sends[auxSendKey(spec.index)] = makeAuxSend(spec);
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["send"] });
  }

  removeAuxSend(channelIndex: number, auxIndex: number): void {
    const channel = this.#channels.get(channelIndex);
    if (!channel || !(auxSendKey(auxIndex) in channel.sends)) return;
    delete channel.sends[auxSendKey(auxIndex)];
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["send"] });
  }

  injectAuxSendUpdate(
    channelIndex: number,
    auxIndex: number,
    fields: Partial<Pick<SendState, "levelDb" | "muted" | "pan">>,
  ): void {
    const channel = this.#channels.get(channelIndex);
    const send = channel?.sends[auxSendKey(auxIndex)];
    if (!channel || !send) return;
    if (fields.levelDb !== undefined) send.levelDb = fields.levelDb;
    if (fields.muted !== undefined) send.muted = fields.muted;
    if (fields.pan !== undefined) send.pan = fields.pan;
    this.#emit({ type: "channel", channel: cloneChannel(channel), changed: ["send"] });
  }

  injectChannelUpdate(
    index: number,
    fields: Partial<Pick<ChannelState, "levelDb" | "muted" | "name" | "pan" | "meterDb">>,
  ): void {
    const channel = this.#channels.get(index);
    if (!channel) return;
    const changed: ChannelField[] = [];
    if (fields.levelDb !== undefined) {
      channel.levelDb = fields.levelDb;
      changed.push("level");
    }
    if (fields.muted !== undefined) {
      channel.muted = fields.muted;
      changed.push("mute");
    }
    if (fields.name !== undefined) {
      channel.name = fields.name;
      changed.push("name");
    }
    if (fields.pan !== undefined) {
      channel.pan = fields.pan;
      changed.push("pan");
    }
    if (fields.meterDb !== undefined) {
      channel.meterDb = fields.meterDb;
      changed.push("meter");
    }
    if (changed.length > 0) this.#emit({ type: "channel", channel: cloneChannel(channel), changed });
  }

  injectBusUpdate(
    type: BusType,
    index: number,
    fields: Partial<Pick<BusState, "levelDb" | "muted" | "name" | "pan" | "meterDb" | "integratedLufs">>,
  ): void {
    const bus = this.#buses.get(busKey(type, index));
    if (!bus) return;
    const changed: BusField[] = [];
    if (fields.levelDb !== undefined) {
      bus.levelDb = fields.levelDb;
      changed.push("level");
    }
    if (fields.muted !== undefined) {
      bus.muted = fields.muted;
      changed.push("mute");
    }
    if (fields.name !== undefined) {
      bus.name = fields.name;
      changed.push("name");
    }
    if (fields.pan !== undefined) {
      bus.pan = fields.pan;
      changed.push("pan");
    }
    if (fields.meterDb !== undefined) {
      bus.meterDb = fields.meterDb;
      changed.push("meter");
    }
    if (fields.integratedLufs !== undefined) {
      bus.integratedLufs = fields.integratedLufs;
      changed.push("integrated");
    }
    if (changed.length > 0) this.#emit({ type: "bus", bus: cloneBus(bus), changed });
  }

  injectMonitorUpdate(
    index: number,
    fields: Partial<Pick<MonitorState, "levelDb" | "muted" | "dimmed" | "name">>,
  ): void {
    const monitor = this.#monitors.get(index);
    if (!monitor) return;
    const changed: MonitorField[] = [];
    if (fields.levelDb !== undefined) {
      monitor.levelDb = fields.levelDb;
      changed.push("level");
    }
    if (fields.muted !== undefined) {
      monitor.muted = fields.muted;
      changed.push("mute");
    }
    if (fields.dimmed !== undefined) {
      monitor.dimmed = fields.dimmed;
      changed.push("dim");
    }
    if (fields.name !== undefined) {
      monitor.name = fields.name;
      changed.push("name");
    }
    if (changed.length > 0) this.#emit({ type: "monitor", monitor: cloneMonitor(monitor), changed });
  }

  setOnAir(value: boolean | null): void {
    this.#onAir = value;
    revision += 1;
    this.#emit({ type: "system", onAir: value });
    this.#logger?.debug("fairlight.mock.on_air_set", { onAir: value });
  }

  injectDisconnect(reason = "mock disconnect"): void {
    if (!this.#connected) return;
    this.#connected = false;
    this.#emit({ type: "disconnected", reason });
  }

  injectStructureChangeDetected(reason: string): void {
    this.#emit({ type: "structure-change-detected", reason });
  }

  injectStructureChanged(summary: StructureChangeSummary): void {
    this.#emit({ type: "structure-changed", summary });
  }

  injectStructureRevalidated(): void {
    this.#emit({ type: "structure-revalidated" });
  }

  injectSnapshot(): void {
    this.#emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  failNextWrite(error: Error): void {
    this.#pendingFailure = error;
  }

  #checkConnected(): void {
    if (!this.#connected) throw new FairlightError("FAIRLIGHT_OFFLINE", "Fairlight is not connected");
  }

  #throwInjectedFailure(): void {
    if (!this.#pendingFailure) return;
    const failure = this.#pendingFailure;
    this.#pendingFailure = null;
    throw failure;
  }

  async #delay(): Promise<void> {
    if (this.#latencyMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.#latencyMs));
  }

  #emit(event: FairlightEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.#logger?.error("fairlight.mock.listener_failed", { error });
      }
    }
  }

}
