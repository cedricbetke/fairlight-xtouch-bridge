import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_NETWORK_PORT,
  defaultLayout,
  isSurfaceRoleId,
  isValidNetworkHost,
  mainRoleOf,
  parseConfig,
  type BridgeConfig,
  type BusType,
  type FixedTargetConfig,
  type LayoutConfig,
  type LcdConfig,
  type MappingConfig,
  type MidiPortSelector,
  type RuntimeArming,
  type SendsOnFaderConfig,
  type SurfaceRole,
} from "../config.js";
import { BridgeError, ConfigError } from "../errors.js";
import { EmberFairlightClient } from "../fairlight/emberClient.js";
import { RtpMidiSession, probeRtpMidi } from "../midi/rtpMidiSession.js";
import { resolveLcdDisplay } from "../lcd/display.js";
import type { Logger } from "../logger.js";
import { ChannelMap } from "../mapping/channelMap.js";
import { encodeSelectLed } from "../mcu/codec.js";
import { resolvePort } from "../midi/deviceManager.js";
import type { MidiBackend, MidiOutputHandle, MidiPortInfo } from "../midi/types.js";
import { VirtualMidiBackend } from "../midi/virtualBackend.js";
import { DEMO_BUSES, DEMO_CHANNELS, DEMO_MONITORS, type DemoBus, type DemoChannel, type DemoMonitor } from "./demo.js";

const STRIPS_PER_SURFACE = 8;
const BLINK_CYCLES = 3;
const BLINK_ON_MS = 280;
const BLINK_OFF_MS = 220;
const MAX_BODY_BYTES = 1_000_000;
const MAX_DEMO_EVENTS = 2000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const ROLE_LABELS: Record<string, string> = {
  main: "X-Touch Main",
  extender1: "Extender 1",
  extender2: "Extender 2",
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface SettingsServerOptions {
  configPath: string;
  config: BridgeConfig;
  demo: boolean;
  port: number;
  host?: string;
  logger: Logger;
  backend?: MidiBackend;
  autoDiscover?: boolean;
  /** Disable the settings page's own Ember+ connection, for example when the desktop app owns it. */
  onAirMonitor?: boolean;
  /** Present when the page runs inside the desktop app. */
  app?: SettingsAppHost;
}

export interface SettingsAppBridgeInfo {
  running: boolean;
  fairlightConnected: boolean;
  devicesOnline: number;
  devicesEnabled: number;
  lastError: string | null;
}

export interface SettingsAppInfo {
  autostart: boolean;
  autostartSupported: boolean;
  arming: RuntimeArming;
  bridge: SettingsAppBridgeInfo;
  onAir: boolean | null;
  fairlightConnected: boolean;
  configPath: string;
  configExists: boolean;
}

export interface SettingsAppHost {
  info(): SettingsAppInfo;
  setAutostart(enabled: boolean): Promise<void> | void;
  setArming(arming: RuntimeArming): Promise<void> | void;
  /** Stop the bridge for a port test, then return a function that starts it again. */
  pauseBridge(): Promise<() => Promise<void>>;
  configSaved(config: BridgeConfig): Promise<void> | void;
}

export interface SettingsServerAddress {
  url: string;
  host: string;
  port: number;
  demo: boolean;
  configPath: string;
}

interface PreviewTarget {
  kind: "channel" | "bus";
  name: string | null;
  channel: number | null;
  busType: string | null;
  index: number | null;
}

interface PreviewStrip {
  strip: number;
  target: PreviewTarget | null;
  fixed: FixedTargetConfig | null;
  lcd: {
    top: string;
    bottom: string;
    color: string;
    colorEnabled: boolean;
    overrideMismatch: boolean;
  };
}

interface PreviewSurface {
  role: SurfaceRole;
  orderIndex: number;
  mode: "fixed" | "banking";
  strips: PreviewStrip[];
}

interface Preview {
  bankOffset: number;
  bankStep: number;
  bankPages: number;
  poolSize: number;
  channelCount: number;
  surfaces: PreviewSurface[];
}

interface PreviewRequest {
  layout?: unknown;
  bankOffset?: unknown;
  enabledRoles?: unknown;
  lcd?: unknown;
}

interface SaveRequest {
  layout?: unknown;
  fairlight?: unknown;
  devices?: unknown;
  lcd?: unknown;
  sendsOnFader?: unknown;
  buttonAssignments?: unknown;
  safety?: unknown;
}

interface DemoEvent {
  seq: number;
  role: SurfaceRole;
  message: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findWebRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, "package.json"))) {
      return join(directory, "web");
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Cannot locate the package root for the settings page");
    }
    directory = parent;
  }
}

export class SettingsServer {
  readonly #configPath: string;
  readonly #logger: Logger;
  readonly #webRoot: string;
  readonly #demo: boolean;
  readonly #port: number;
  readonly #host: string;
  readonly #autoDiscover: boolean;
  readonly #onAirMonitor: boolean;
  readonly #app: SettingsAppHost | null;
  #config: BridgeConfig;
  #backend: MidiBackend;
  #server: ReturnType<typeof createServer> | null = null;
  #boundPort: number;
  #channels: DemoChannel[] = [];
  #buses: DemoBus[] = [];
  #monitors: DemoMonitor[] = [];
  #demoBackend: VirtualMidiBackend | null = null;
  #demoPortKeys = new Set<string>();
  #demoEvents: DemoEvent[] = [];
  #demoSeq = 0;
  #busyOutputs = new Set<number>();
  #onAir: boolean | null = null;
  #fairlightConnected = false;
  #onAirClient: EmberFairlightClient | null = null;
  #started = false;

  constructor(options: SettingsServerOptions) {
    this.#configPath = resolve(options.configPath);
    this.#config = options.config;
    this.#logger = options.logger.child({ component: "settings" });
    this.#demo = options.demo;
    this.#port = options.port;
    this.#boundPort = options.port;
    this.#host = options.host ?? "127.0.0.1";
    this.#autoDiscover = options.autoDiscover ?? true;
    this.#app = options.app ?? null;
    this.#onAirMonitor = options.onAirMonitor ?? options.app === undefined;
    this.#webRoot = findWebRoot();
    this.#backend = options.backend ?? this.#buildDemoBackend();
    if (this.#demo) {
      this.#channels = [...DEMO_CHANNELS];
      this.#buses = [...DEMO_BUSES];
      this.#monitors = [...DEMO_MONITORS];
      // Demo data is simulated; on-air stays unknown because no Fairlight is connected.
      this.#onAir = null;
    }
  }

  get configPath(): string {
    return this.#configPath;
  }

  get url(): string {
    return `http://${this.#host}:${this.#boundPort}`;
  }

  async start(): Promise<SettingsServerAddress> {
    if (this.#started) return this.#address();
    if (!existsSync(join(this.#webRoot, "index.html"))) {
      throw new BridgeError("SETTINGS_ASSETS_MISSING", `Settings page not found at ${this.#webRoot}`);
    }
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolvePromise();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.#port, this.#host);
    });
    this.#server = server;
    this.#started = true;
    const bound = server.address();
    if (bound && typeof bound === "object") this.#boundPort = bound.port;
    if (!this.#demo && this.#autoDiscover && this.#onAirMonitor) this.#startOnAirMonitor();
    if (!this.#demo && this.#autoDiscover) {
      try {
        const snapshot = await this.#discover(this.#config.fairlight.host, this.#config.fairlight.port);
        this.#channels = snapshot.channels;
        this.#buses = snapshot.buses;
        this.#monitors = snapshot.monitors;
        this.#logger.info("settings.channels_discovered", {
          count: snapshot.channels.length,
          buses: snapshot.buses.length,
          monitors: snapshot.monitors.length,
        });
      } catch (error) {
        this.#logger.warn("settings.channels_discovery_failed", { error: errorMessage(error) });
      }
    }
    this.#logger.info("settings.started", {
      url: this.url,
      demo: this.#demo,
      configPath: this.#configPath,
    });
    return this.#address();
  }

  async stop(): Promise<void> {
    if (!this.#started || !this.#server) return;
    const server = this.#server;
    this.#server = null;
    this.#started = false;
    const onAirClient = this.#onAirClient;
    if (onAirClient) {
      await onAirClient.disconnect().catch(() => undefined);
      if (this.#onAirClient === onAirClient) this.#onAirClient = null;
    }
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
    });
    this.#logger.info("settings.stopped");
  }

  #address(): SettingsServerAddress {
    return {
      url: this.url,
      host: this.#host,
      port: this.#boundPort,
      demo: this.#demo,
      configPath: this.#configPath,
    };
  }

  #buildDemoBackend(): MidiBackend {
    const backend = this.#demoBackend ?? new VirtualMidiBackend();
    this.#demoBackend = backend;
    for (const device of this.#config.midi.devices) {
      if (!device.enabled || device.transport === "network") continue;
      const outputName = device.output.name || device.input.name;
      this.#addDemoPort(backend, {
        inputName: device.input.name,
        inputOccurrence: device.input.occurrence,
        outputName,
        outputOccurrence: device.output.occurrence,
      });
    }
    return backend;
  }

  #resetDemoBackend(): void {
    this.#demoBackend = null;
    this.#demoPortKeys.clear();
    this.#backend = this.#buildDemoBackend();
  }

  #addDemoPort(
    backend: VirtualMidiBackend,
    selector: {
      inputName: string;
      inputOccurrence: number;
      outputName: string;
      outputOccurrence: number;
    },
  ): void {
    const key = JSON.stringify([
      selector.inputName,
      selector.inputOccurrence,
      selector.outputName,
      selector.outputOccurrence,
    ]);
    if (this.#demoPortKeys.has(key)) return;
    this.#demoPortKeys.add(key);
    backend.addDevice({
      inputName: selector.inputName,
      outputName: selector.outputName,
      allowDuplicateNames: true,
    });
  }

  #startOnAirMonitor(): void {
    if (this.#demo || this.#onAirClient) return;
    const client = new EmberFairlightClient({
      host: this.#config.fairlight.host,
      port: this.#config.fairlight.port,
      requestTimeoutMs: this.#config.fairlight.requestTimeoutMs,
      reconnectAttempts: 0,
      autoReconnect: true,
      logger: this.#logger,
    });
    this.#onAirClient = client;
    client.onEvent((event) => {
      if (this.#onAirClient !== client) return;
      if (event.type === "system") {
        if (this.#onAir !== event.onAir) {
          this.#onAir = event.onAir;
          this.#logger.debug("settings.on_air_changed", { onAir: event.onAir });
        }
        return;
      }
      if (event.type === "connected") {
        this.#fairlightConnected = true;
        this.#onAir = event.snapshot.onAir;
        this.#logger.info("settings.on_air_connected", {
          host: this.#config.fairlight.host,
          port: this.#config.fairlight.port,
          onAir: event.snapshot.onAir,
        });
        return;
      }
      if (event.type === "disconnected") {
        this.#fairlightConnected = false;
        this.#onAir = null;
        this.#logger.debug("settings.on_air_disconnected", { reason: event.reason });
      }
    });
    void client.connect().catch((error) => {
      this.#logger.warn("settings.on_air_connect_failed", { error: errorMessage(error) });
    });
  }

  #enabledRoles(): SurfaceRole[] {
    return this.#config.midi.devices
      .filter((device) => device.enabled)
      .map((device) => device.role);
  }

  #configuredRoles(): SurfaceRole[] {
    return this.#config.midi.devices.map((device) => device.role);
  }

  #layoutFromDevices(): LayoutConfig {
    if (this.#config.midi.devices.length === 0) return defaultLayout();
    const order = this.#config.midi.devices.map((device) => device.role);
    const surfaces: LayoutConfig["surfaces"] = {};
    for (const role of order) surfaces[role] = { mode: "banking", fixedTargets: [] };
    return { order, surfaces };
  }

  #roleLabels(): Record<string, string> {
    const mainRole = mainRoleOf(this.#config.midi.devices);
    const labels: Record<string, string> = {};
    let extender = 0;
    for (const device of this.#config.midi.devices) {
      if (device.role === mainRole && device.kind === "main") {
        labels[device.role] = device.name ?? "X-Touch Main";
        continue;
      }
      extender += 1;
      labels[device.role] = device.name ?? ROLE_LABELS[device.role] ?? `Extender ${extender}`;
    }
    return labels;
  }

  #listPorts(): { inputs: MidiPortInfo[]; outputs: MidiPortInfo[]; error: string | null } {
    try {
      return {
        inputs: this.#backend.listInputs(),
        outputs: this.#backend.listOutputs(),
        error: null,
      };
    } catch (error) {
      return { inputs: [], outputs: [], error: errorMessage(error) };
    }
  }

  async #reserveDemoPort(request: IncomingMessage): Promise<Record<string, unknown>> {
    if (!this.#demo || !this.#demoBackend) {
      throw new HttpError(400, "MIDI-Ports können nur in der Demo hinzugefügt werden");
    }
    const body = (await this.#readJson(request)) as Record<string, unknown>;
    const requested = typeof body["name"] === "string" ? body["name"].trim() : "";
    const name = requested === "" ? "X-Touch Extender" : requested;
    const occurrence = this.#demoBackend.listInputs().filter((port) => port.name === name).length;
    this.#addDemoPort(this.#demoBackend, {
      inputName: name,
      inputOccurrence: occurrence,
      outputName: name,
      outputOccurrence: occurrence,
    });
    return {
      input: { name, occurrence },
      output: { name, occurrence },
      ports: this.#listPorts(),
    };
  }

  #state(): Record<string, unknown> {
    const layout = this.#config.mapping.layout ?? this.#layoutFromDevices();
    const app = this.#app?.info() ?? null;
    return {
      demo: this.#demo,
      configPath: this.#configPath,
      config: this.#config,
      layout,
      devices: this.#config.midi.devices,
      lcd: this.#config.lcd,
      midi: this.#listPorts(),
      channels: this.#channels,
      buses: this.#buses,
      monitors: this.#monitors,
      preview: this.#preview(layout, 0),
      onAir: app ? app.onAir : this.#onAir,
      fairlight: {
        host: this.#config.fairlight.host,
        port: this.#config.fairlight.port,
        onAir: app ? app.onAir : this.#onAir,
        connected: app ? app.fairlightConnected : this.#fairlightConnected,
      },
      roleLabels: this.#roleLabels(),
      ...(app ? { app } : {}),
    };
  }

  #preview(
    layout: LayoutConfig,
    bankOffset: number,
    enabledRoles = this.#enabledRoles(),
    lcd: LcdConfig = this.#config.lcd,
  ): Preview {
    const mapping: MappingConfig = {
      ...this.#config.mapping,
      singleChannel: null,
      singleChannelName: null,
      layout,
    };
    const map = new ChannelMap(mapping, {
      enabledRoles,
      roleOrder: layout.order,
      mainRole: mainRoleOf(this.#config.midi.devices),
    });
    const maxChannel = this.#channels.reduce((max, channel) => Math.max(max, channel.index), 0);
    map.setChannelCount(maxChannel);
    map.setBankOffset(bankOffset);
    const channelNames = new Map(this.#channels.map((channel) => [channel.index, channel.name]));
    const busNames = new Map(this.#buses.map((bus) => [`${bus.type}:${bus.index}`, bus.name]));
    const surfaces: PreviewSurface[] = layout.order.map((role, orderIndex) => {
      const assignment = layout.surfaces[role] ?? { mode: "banking", fixedTargets: [] };
      const strips: PreviewStrip[] = [];
      for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
        const resolved = map.resolve(role, strip);
        let target: PreviewTarget | null = null;
        if (resolved?.kind === "channel") {
          target = {
            kind: "channel",
            name: channelNames.get(resolved.channel) ?? null,
            channel: resolved.channel,
            busType: null,
            index: null,
          };
        } else if (resolved?.kind === "bus") {
          target = {
            kind: "bus",
            name: busNames.get(`${resolved.busType}:${resolved.index}`) ?? null,
            channel: null,
            busType: resolved.busType,
            index: resolved.index,
          };
        }
        const display = resolveLcdDisplay(
          lcd,
          target?.kind === "channel"
            ? { kind: "channel", index: target.channel ?? 0, name: target.name ?? "" }
            : target?.kind === "bus"
              ? {
                  kind: "bus",
                  busType: target.busType as BusType,
                  index: target.index ?? 0,
                  name: target.name ?? "",
                }
              : null,
        );
        strips.push({
          strip,
          target,
          fixed: assignment.mode === "fixed" ? (assignment.fixedTargets[strip] ?? null) : null,
          lcd: {
            top: display.top,
            bottom: display.bottom,
            color: display.color,
            colorEnabled: display.colorEnabled,
            overrideMismatch: display.overrideMismatch,
          },
        });
      }
      return { role, orderIndex, mode: assignment.mode, strips };
    });
    return {
      bankOffset: map.bankOffset,
      bankStep: map.bankStep,
      bankPages: map.bankPages,
      poolSize: map.bankingPoolSize,
      channelCount: this.#channels.length,
      surfaces,
    };
  }

  async #discover(
    host: string,
    port: number,
  ): Promise<{ channels: DemoChannel[]; buses: DemoBus[]; monitors: DemoMonitor[] }> {
    if (this.#demo) {
      return { channels: [...DEMO_CHANNELS], buses: [...DEMO_BUSES], monitors: [...DEMO_MONITORS] };
    }
    const client = new EmberFairlightClient({
      host,
      port,
      requestTimeoutMs: this.#config.fairlight.requestTimeoutMs,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger: this.#logger,
    });
    try {
      await client.connect();
      const snapshot = client.snapshot();
      return {
        channels: snapshot.channels
          .map((channel) => ({ index: channel.index, name: channel.name }))
          .sort((a, b) => a.index - b.index),
        buses: snapshot.buses
          .map((bus) => ({
            type: bus.type,
            index: bus.index,
            name: bus.name,
            meterDb: bus.meterDb,
            integratedLufs: bus.integratedLufs,
          }))
          .sort((a, b) => (a.type === b.type ? a.index - b.index : a.type.localeCompare(b.type))),
        monitors: snapshot.monitors
          .map((monitor) => ({ index: monitor.index, name: monitor.name }))
          .sort((a, b) => a.index - b.index),
      };
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    const url = new URL(request.url ?? "/", this.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        await this.#handleApi(request, response, url);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        this.#sendJson(response, 405, { error: "Methode nicht erlaubt" });
        return;
      }
      this.#serveStatic(url.pathname, response, request.method === "HEAD");
    } catch (error) {
      this.#sendError(response, error);
    }
  }

  async #handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method ?? "GET";
    if (method === "POST") this.#checkOrigin(request);
    if (url.pathname === "/api/state" && method === "GET") {
      this.#sendJson(response, 200, this.#state());
      return;
    }
    if (url.pathname === "/api/app" && method === "GET") {
      if (!this.#app) throw new HttpError(404, "Es läuft keine Desktop-App");
      this.#sendJson(response, 200, { app: this.#app.info() });
      return;
    }
    if (url.pathname === "/api/app" && method === "POST") {
      if (!this.#app) throw new HttpError(404, "Es läuft keine Desktop-App");
      this.#sendJson(response, 200, { ok: true, app: await this.#updateApp(await this.#readJson(request)) });
      return;
    }
    if (url.pathname === "/api/onair" && method === "GET") {
      const app = this.#app?.info() ?? null;
      this.#sendJson(response, 200, {
        onAir: app ? app.onAir : this.#onAir,
        connected: app ? app.fairlightConnected : this.#fairlightConnected,
      });
      return;
    }
    if (url.pathname === "/api/midi/ports" && method === "GET") {
      this.#sendJson(response, 200, this.#listPorts());
      return;
    }
    if (url.pathname === "/api/midi/ports" && method === "POST") {
      this.#sendJson(response, 200, await this.#reserveDemoPort(request));
      return;
    }
    if (url.pathname === "/api/demo/midi" && method === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0");
      const events = this.#demo
        ? this.#demoEvents.filter((event) => event.seq > (Number.isFinite(since) ? since : 0))
        : [];
      this.#sendJson(response, 200, { seq: this.#demoSeq, events });
      return;
    }
    if (url.pathname === "/api/preview" && method === "POST") {
      const body = (await this.#readJson(request)) as PreviewRequest;
      const layout = this.#readLayout(body.layout);
      const bankOffset = typeof body.bankOffset === "number" ? body.bankOffset : 0;
      const enabledRoles = this.#readEnabledRoles(body.enabledRoles);
      const lcd = this.#readLcd(body.lcd);
      this.#sendJson(response, 200, this.#preview(layout, bankOffset, enabledRoles, lcd));
      return;
    }
    if (url.pathname === "/api/find" && method === "POST") {
      const body = (await this.#readJson(request)) as Record<string, unknown>;
      const role = body["role"];
      if (typeof role !== "string" || !this.#configuredRoles().includes(role)) {
        throw new HttpError(400, "Unbekanntes Gerät");
      }
      const resumeBridge = await this.#pauseForDeviceTest();
      try {
        const device = this.#config.midi.devices.find((entry) => entry.role === role);
        if (device?.transport === "network") {
          const result = await this.#blink(role, null);
          this.#sendJson(response, 200, result);
          return;
        }
        const selector = this.#readPortSelector(body["output"]);
        const result = await this.#blink(role, selector);
        this.#sendJson(response, 200, result);
      } finally {
        await resumeBridge();
      }
      return;
    }
    if (url.pathname === "/api/network/test" && method === "POST") {
      const body = (await this.#readJson(request)) as Record<string, unknown>;
      const resumeBridge = await this.#pauseForDeviceTest();
      try {
        this.#sendJson(response, 200, await this.#testNetwork(body));
      } finally {
        await resumeBridge();
      }
      return;
    }
    if (url.pathname === "/api/discover" && method === "POST") {
      const body = (await this.#readJson(request)) as Record<string, unknown>;
      const host = typeof body["host"] === "string" && body["host"].trim() !== ""
        ? body["host"].trim()
        : this.#config.fairlight.host;
      const port = typeof body["port"] === "number" ? body["port"] : this.#config.fairlight.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new HttpError(400, "Der Fairlight-Port muss zwischen 1 und 65535 liegen");
      }
      const snapshot = await this.#discover(host, port);
      this.#channels = snapshot.channels;
      this.#buses = snapshot.buses;
      this.#monitors = snapshot.monitors;
      this.#sendJson(response, 200, snapshot);
      return;
    }
    if (url.pathname === "/api/save" && method === "POST") {
      const body = (await this.#readJson(request)) as SaveRequest;
      const result = await this.#save(body);
      this.#sendJson(response, 200, result);
      return;
    }
    this.#sendJson(response, 404, { error: "Unbekannter API-Endpunkt" });
  }

  async #pauseForDeviceTest(): Promise<() => Promise<void>> {
    if (!this.#app || this.#demo) return async () => undefined;
    return this.#app.pauseBridge();
  }

  async #updateApp(value: unknown): Promise<SettingsAppInfo> {
    if (!this.#app) throw new HttpError(404, "Es läuft keine Desktop-App");
    if (!isRecord(value)) throw new HttpError(400, "Einstellungen fehlen");
    const current = this.#app.info();
    const autostart = value["autostart"];
    if (autostart !== undefined && typeof autostart !== "boolean") {
      throw new HttpError(400, "autostart muss true oder false sein");
    }
    const writes = value["writes"];
    if (writes !== undefined && typeof writes !== "boolean") {
      throw new HttpError(400, "writes muss true oder false sein");
    }
    const motors = value["motors"];
    if (motors !== undefined && typeof motors !== "boolean") {
      throw new HttpError(400, "motors muss true oder false sein");
    }
    const nextArming: RuntimeArming = {
      writes: writes ?? current.arming.writes,
      motors: motors ?? current.arming.motors,
    };
    if (nextArming.motors && !nextArming.writes) {
      throw new HttpError(400, "Motoren erfordern die Freigabe für Schreibzugriffe");
    }
    if (autostart !== undefined) await this.#app.setAutostart(autostart);
    if (nextArming.writes !== current.arming.writes || nextArming.motors !== current.arming.motors) {
      await this.#app.setArming(nextArming);
    }
    return this.#app.info();
  }

  #checkOrigin(request: IncomingMessage): void {
    const origin = request.headers.origin;
    if (origin === undefined) return;
    const allowed = new Set([`http://${this.#host}:${this.#boundPort}`, `http://localhost:${this.#boundPort}`]);
    if (!allowed.has(origin)) throw new HttpError(403, "Anfrage von unbekannter Herkunft abgelehnt");
  }

  async #readJson(request: IncomingMessage): Promise<unknown> {
    const contentType = request.headers["content-type"] ?? "";
    if (!String(contentType).includes("application/json")) {
      throw new HttpError(415, "Anfragen müssen als application/json gesendet werden");
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, "Anfrage ist zu groß");
      chunks.push(buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "Ungültiges JSON");
    }
  }

  #readLayout(value: unknown): LayoutConfig {
    if (!isRecord(value)) throw new HttpError(400, "Layout fehlt");
    const parsed = parseConfig({ mapping: { layout: value } }).mapping.layout;
    if (!parsed) throw new HttpError(400, "Layout fehlt");
    return parsed;
  }

  #readLcd(value: unknown): LcdConfig {
    if (value === undefined) return this.#config.lcd;
    try {
      return parseConfig({ lcd: value }).lcd;
    } catch (error) {
      if (error instanceof ConfigError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  #readSendsOnFader(value: unknown): SendsOnFaderConfig {
    if (value === undefined) return this.#config.mapping.sendsOnFader;
    try {
      return parseConfig({ mapping: { sendsOnFader: value } }).mapping.sendsOnFader;
    } catch (error) {
      if (error instanceof ConfigError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  #readButtonAssignments(value: unknown): MappingConfig["buttonAssignments"] {
    if (value === undefined) return this.#config.mapping.buttonAssignments;
    try {
      return parseConfig({ mapping: { buttonAssignments: value } }).mapping.buttonAssignments;
    } catch (error) {
      if (error instanceof ConfigError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  #readSafety(value: unknown): BridgeConfig["safety"] {
    if (value === undefined) return this.#config.safety;
    if (!isRecord(value)) throw new HttpError(400, "Sicherheitseinstellungen müssen ein Objekt sein");
    try {
      return parseConfig({ safety: { ...this.#config.safety, ...value } }).safety;
    } catch (error) {
      if (error instanceof ConfigError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  #readEnabledRoles(value: unknown): SurfaceRole[] {
    if (value === undefined) return this.#enabledRoles();
    if (!Array.isArray(value)) throw new HttpError(400, "enabledRoles muss eine Liste sein");
    const roles: SurfaceRole[] = [];
    for (const entry of value) {
      if (typeof entry !== "string" || !isSurfaceRoleId(entry)) {
        throw new HttpError(400, "Unbekanntes Gerät in enabledRoles");
      }
      roles.push(entry);
    }
    return roles;
  }

  #readPortSelector(value: unknown): MidiPortSelector {
    if (typeof value === "string" && value.trim() !== "") {
      return { name: value, occurrence: 0 };
    }
    if (isRecord(value)) {
      const name = value["name"];
      const occurrence = value["occurrence"] ?? 0;
      if (
        typeof name === "string" &&
        name.trim() !== "" &&
        typeof occurrence === "number" &&
        Number.isInteger(occurrence) &&
        occurrence >= 0
      ) {
        return { name, occurrence };
      }
    }
    throw new HttpError(400, "Kein gültiger MIDI-Ausgang ausgewählt");
  }

  async #testNetwork(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const role = body["role"];
    if (typeof role !== "string" || !this.#configuredRoles().includes(role)) {
      throw new HttpError(400, "Unbekanntes Gerät");
    }
    const host = typeof body["host"] === "string" ? body["host"].trim() : "";
    if (host === "") throw new HttpError(400, "Bitte eine IP-Adresse oder einen Hostnamen eintragen");
    if (!isValidNetworkHost(host)) {
      throw new HttpError(400, "Die Adresse muss eine IPv4-Adresse oder ein Hostname sein");
    }
    const port = typeof body["port"] === "number" ? body["port"] : Number(body["port"] ?? DEFAULT_NETWORK_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65534) {
      throw new HttpError(400, "Der RTP-MIDI-Port muss zwischen 1 und 65534 liegen");
    }
    if (this.#demo) {
      this.#logger.info("settings.network_test", { role, host, port, simulated: true });
      return {
        ok: true,
        simulated: true,
        transport: "network",
        role,
        host,
        port,
        message: "Simulation: RTP-MIDI-Sitzung erreichbar",
      };
    }
    const result = await probeRtpMidi({ host, port, timeoutMs: 4000, logger: this.#logger });
    this.#logger.info("settings.network_test", { role, host, port, ok: result.ok, reason: result.reason });
    if (!result.ok) {
      throw new HttpError(
        409,
        `RTP-MIDI-Sitzung mit ${host}:${port} nicht möglich: ${result.reason ?? "keine Antwort"}. Läuft die Bridge bereits für dieses Gerät?`,
      );
    }
    return {
      ok: true,
      simulated: false,
      transport: "network",
      role,
      host,
      port,
      message: `RTP-MIDI-Sitzung mit ${host}:${port} angenommen`,
    };
  }

  async #blink(role: SurfaceRole, selector: MidiPortSelector | null): Promise<Record<string, unknown>> {
    const device = this.#config.midi.devices.find((entry) => entry.role === role);
    if (device?.transport === "network") {
      if (!this.#demo) {
        throw new HttpError(
          409,
          "Gerät finden ist über RTP-MIDI noch nicht verfügbar. Der Verbindungstest prüft die Sitzung.",
        );
      }
      await this.#blinkSimulated(role);
      this.#logger.info("settings.find", { role, transport: "network", simulated: true });
      return {
        ok: true,
        simulated: true,
        transport: "network",
        host: device.network?.host ?? null,
        port: device.network?.port ?? null,
        cycles: BLINK_CYCLES,
      };
    }
    if (selector === null) throw new HttpError(400, "Kein gültiger MIDI-Ausgang ausgewählt");
    const ports = this.#backend.listOutputs();
    const resolution = resolvePort(ports, selector);
    if (!resolution.ok) throw new HttpError(400, resolution.reason);
    const outputIndex = resolution.port.info.index;
    if (this.#busyOutputs.has(outputIndex)) {
      throw new HttpError(409, "Dieses Gerät blinkt bereits");
    }
    this.#busyOutputs.add(outputIndex);
    let output: MidiOutputHandle | undefined;
    try {
      output = this.#backend.openOutput(outputIndex);
      for (let cycle = 0; cycle < BLINK_CYCLES; cycle += 1) {
        for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
          this.#sendToOutput(role, output, encodeSelectLed(strip, true));
        }
        await delay(BLINK_ON_MS);
        for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
          this.#sendToOutput(role, output, encodeSelectLed(strip, false));
        }
        await delay(BLINK_OFF_MS);
      }
    } finally {
      if (output) {
        try {
          for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
            this.#sendToOutput(role, output, encodeSelectLed(strip, false));
          }
        } catch {
          // The output may already be gone; closing still releases the handle.
        }
        output.close();
      }
      this.#busyOutputs.delete(outputIndex);
    }
    this.#logger.info("settings.find", {
      role,
      output: resolution.port.info.name,
      occurrence: selector.occurrence,
    });
    return {
      ok: true,
      output: resolution.port.info.name,
      occurrence: selector.occurrence,
      cycles: BLINK_CYCLES,
    };
  }

  async #blinkSimulated(role: SurfaceRole): Promise<void> {
    for (let cycle = 0; cycle < BLINK_CYCLES; cycle += 1) {
      for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
        this.#recordDemo(role, encodeSelectLed(strip, true));
      }
      await delay(BLINK_ON_MS);
      for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
        this.#recordDemo(role, encodeSelectLed(strip, false));
      }
      await delay(BLINK_OFF_MS);
    }
    for (let strip = 0; strip < STRIPS_PER_SURFACE; strip += 1) {
      this.#recordDemo(role, encodeSelectLed(strip, false));
    }
  }

  #sendToOutput(role: SurfaceRole, output: { send(message: number[]): void }, message: number[]): void {
    output.send(message);
    this.#recordDemo(role, message);
  }

  #recordDemo(role: SurfaceRole, message: number[]): void {
    if (!this.#demo) return;
    this.#demoSeq += 1;
    this.#demoEvents.push({ seq: this.#demoSeq, role, message: [...message] });
    if (this.#demoEvents.length > MAX_DEMO_EVENTS) {
      this.#demoEvents.splice(0, this.#demoEvents.length - MAX_DEMO_EVENTS);
    }
  }

  async #save(body: SaveRequest): Promise<Record<string, unknown>> {
    const layout = this.#readLayout(body.layout);
    const lcd = this.#readLcd(body.lcd);
    const sendsOnFader = this.#readSendsOnFader(body.sendsOnFader);
    const buttonAssignments = this.#readButtonAssignments(body.buttonAssignments);
    const safety = this.#readSafety(body.safety);
    const fairlightObject = isRecord(body.fairlight) ? body.fairlight : {};
    const host =
      typeof fairlightObject["host"] === "string" && fairlightObject["host"].trim() !== ""
        ? fairlightObject["host"]
        : this.#config.fairlight.host;
    const port = typeof fairlightObject["port"] === "number" ? fairlightObject["port"] : this.#config.fairlight.port;
    if (!Array.isArray(body.devices)) throw new HttpError(400, "Geräte fehlen");
    const devices = body.devices.map((device) => {
      if (!isRecord(device)) throw new HttpError(400, "Ungültige Gerätedaten");
      const existing = this.#config.midi.devices.find((entry) => entry.role === device["role"]);
      return {
        role: device["role"],
        kind: device["kind"] ?? ((device["role"] === "main") ? "main" : "extender"),
        name: device["name"] ?? null,
        enabled: device["enabled"] ?? true,
        transport: device["transport"],
        input: device["input"],
        output: device["output"],
        network: device["network"],
        encoder: device["encoder"] ?? "off",
        meters: device["meters"] ?? false,
        mainDisplay:
          device["mainDisplay"] === undefined ? existing?.mainDisplay : device["mainDisplay"],
      };
    });
    const candidate = parseConfig({
      fairlight: {
        host,
        port,
        requestTimeoutMs: this.#config.fairlight.requestTimeoutMs,
        reconnectAttempts: this.#config.fairlight.reconnectAttempts,
      },
      midi: {
        ...this.#config.midi,
        devices,
      },
      mapping: {
        ...this.#config.mapping,
        singleChannel: null,
        singleChannelName: null,
        layout,
        sendsOnFader,
        buttonAssignments,
      },
      lcd,
      safety,
      logLevel: this.#config.logLevel,
    });
    if (!candidate.midi.devices.some((device) => device.enabled)) {
      throw new HttpError(400, "Mindestens ein Gerät muss aktiviert sein");
    }
    const serialised = `${JSON.stringify(candidate, null, 2)}\n`;
    const directory = dirname(this.#configPath);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.${basename(this.#configPath)}.${process.pid}.tmp`);
    try {
      writeFileSync(temporary, serialised, "utf8");
      renameSync(temporary, this.#configPath);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new BridgeError("SETTINGS_SAVE_FAILED", `Konfiguration konnte nicht geschrieben werden: ${errorMessage(error)}`);
    }
    this.#config = candidate;
    if (this.#demo) this.#resetDemoBackend();
    this.#logger.info("settings.saved", { configPath: this.#configPath });
    if (this.#app) await this.#app.configSaved(candidate);
    return {
      ok: true,
      configPath: this.#configPath,
      config: candidate,
      requiresRestart: this.#app === null,
    };
  }

  #serveStatic(pathname: string, response: ServerResponse, headOnly: boolean): void {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, "Ungültiger Pfad");
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const extension = extname(relative).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) {
      this.#sendJson(response, 404, { error: "Nicht gefunden" });
      return;
    }
    const filePath = resolve(this.#webRoot, relative);
    if (!filePath.startsWith(this.#webRoot + sep)) {
      this.#sendJson(response, 403, { error: "Zugriff verweigert" });
      return;
    }
    let content: Buffer;
    try {
      content = readFileSync(filePath);
    } catch {
      this.#sendJson(response, 404, { error: "Nicht gefunden" });
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Length", String(content.length));
    if (headOnly) {
      response.end();
      return;
    }
    response.end(content);
  }

  #sendJson(response: ServerResponse, status: number, payload: unknown): void {
    if (response.headersSent) return;
    const body = JSON.stringify(payload);
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Length", Buffer.byteLength(body));
    response.end(body);
  }

  #sendError(response: ServerResponse, error: unknown): void {
    if (error instanceof HttpError) {
      this.#sendJson(response, error.status, { error: error.message });
      return;
    }
    if (error instanceof ConfigError) {
      this.#sendJson(response, 400, { error: error.message, details: error.details ?? null });
      return;
    }
    if (error instanceof BridgeError) {
      this.#sendJson(response, 500, { error: error.message, code: error.code });
      return;
    }
    this.#logger.error("settings.request_failed", { error });
    this.#sendJson(response, 500, { error: "Interner Fehler in der Einstellungsseite" });
  }
}
