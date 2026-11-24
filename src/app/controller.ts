import { existsSync, mkdirSync } from "node:fs";

import { DEFAULT_CONFIG, loadConfig, type BridgeConfig, type RuntimeArming } from "../config.js";
import { BridgeError } from "../errors.js";
import type { Logger } from "../logger.js";
import { EmptyMidiBackend } from "../midi/emptyBackend.js";
import { NativeMidiBackend } from "../midi/realBackend.js";
import type { MidiBackend } from "../midi/types.js";
import { Bridge } from "../runtime/bridge.js";
import { SettingsServer, type SettingsAppHost, type SettingsAppInfo } from "../settings/server.js";
import { NoopAutostart, type AutostartController } from "./autostart.js";
import { defaultDataDir, appSettingsFilePath, configFilePath, logFilePath } from "./paths.js";
import { AppSettingsStore } from "./settings.js";

export interface DesktopControllerOptions {
  dataDir?: string;
  logger: Logger;
  openExternal?: (url: string) => void | Promise<void>;
  autostart?: AutostartController;
  settingsPort?: number;
  backendFactory?: (needsUsb: boolean) => Promise<MidiBackend>;
}

export interface DesktopStartOptions {
  /** Autostart at login: no browser window, quiet startup. */
  hidden?: boolean;
}

const DEFAULT_SETTINGS_PORT = 8787;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the bridge and the settings page for the desktop app.
 *
 * The app is the on/off switch: starting it starts the bridge, quitting it
 * stops the bridge. Configuration changes from the settings page restart the
 * bridge in place, so no terminal or manual restart is needed.
 */
export class DesktopController implements SettingsAppHost {
  readonly #dataDir: string;
  readonly #configPath: string;
  readonly #logger: Logger;
  readonly #store: AppSettingsStore;
  readonly #autostart: AutostartController;
  readonly #openExternal: (url: string) => void | Promise<void>;
  readonly #settingsPort: number;
  readonly #backendFactory: (needsUsb: boolean) => Promise<MidiBackend>;
  #server: SettingsServer | null = null;
  #bridge: Bridge | null = null;
  #config: BridgeConfig = structuredClone(DEFAULT_CONFIG);
  #arming: RuntimeArming = { writes: false, motors: false };
  #lastError: string | null = null;
  #started = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: DesktopControllerOptions) {
    this.#dataDir = options.dataDir ?? defaultDataDir();
    this.#configPath = configFilePath(this.#dataDir);
    this.#logger = options.logger;
    this.#store = new AppSettingsStore(appSettingsFilePath(this.#dataDir));
    this.#autostart = options.autostart ?? new NoopAutostart();
    this.#openExternal = options.openExternal ?? (() => undefined);
    this.#settingsPort = options.settingsPort ?? DEFAULT_SETTINGS_PORT;
    this.#backendFactory =
      options.backendFactory ??
      (async (needsUsb) => (needsUsb ? NativeMidiBackend.create() : new EmptyMidiBackend()));
    this.#syncAutostartState();
    mkdirSync(this.#dataDir, { recursive: true });
  }

  get dataDir(): string {
    return this.#dataDir;
  }

  get configPath(): string {
    return this.#configPath;
  }

  get logPath(): string {
    return logFilePath(this.#dataDir);
  }

  get url(): string {
    return this.#server?.url ?? "";
  }

  async start(options: DesktopStartOptions = {}): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const configExists = existsSync(this.#configPath);
    this.#loadInitialConfig();
    await this.#startServer(configExists);
    await this.#enqueue(() => this.#applyBridgeInternal());
    this.#logger.info("app.started", {
      dataDir: this.#dataDir,
      configPath: this.#configPath,
      configExists,
      hidden: options.hidden === true,
      url: this.url,
    });
    if (!options.hidden) await this.openSettings();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await this.#enqueue(async () => {
      await this.#stopBridgeInternal();
      const server = this.#server;
      this.#server = null;
      await server?.stop();
    });
    this.#logger.info("app.stopped");
  }

  async openSettings(): Promise<void> {
    if (!this.#server) return;
    await this.#openExternal(this.#server.url);
  }

  info(): SettingsAppInfo {
    const status = this.#bridge?.status();
    const devices = status?.devices ?? [];
    const enabled = devices.filter((device) => device.enabled);
    const fairlightConnected = status?.fairlight.connected ?? false;
    return {
      autostart: this.#store.get().autostart,
      autostartSupported: this.#autostart.supported,
      arming: { ...this.#arming },
      bridge: {
        running: this.#bridge !== null,
        fairlightConnected,
        devicesOnline: enabled.filter((device) => device.online).length,
        devicesEnabled: enabled.length,
        lastError: this.#lastError,
      },
      onAir: fairlightConnected ? (status?.fairlight.onAir ?? null) : null,
      fairlightConnected,
      configPath: this.#configPath,
      configExists: existsSync(this.#configPath),
    };
  }

  async setAutostart(enabled: boolean): Promise<void> {
    if (!this.#autostart.supported) {
      throw new BridgeError("AUTOSTART_UNSUPPORTED", "Autostart wird auf diesem System nicht unterstützt");
    }
    await this.#autostart.setEnabled(enabled);
    this.#store.setAutostart(enabled);
    this.#logger.info("app.autostart_changed", { enabled });
  }

  async setArming(arming: RuntimeArming): Promise<void> {
    if (arming.motors && !arming.writes) {
      throw new BridgeError("APP_ARMING_INVALID", "Motoren erfordern die Freigabe für Schreibzugriffe");
    }
    await this.#enqueue(async () => {
      if (arming.writes === this.#arming.writes && arming.motors === this.#arming.motors) return;
      this.#arming = { ...arming };
      this.#logger.info("app.arming_changed", { arming: this.#arming });
      if (this.#bridge) await this.#applyBridgeInternal();
    });
  }

  async pauseBridge(): Promise<() => Promise<void>> {
    await this.#enqueue(() => this.#stopBridgeInternal());
    return async () => {
      await this.#enqueue(() => this.#applyBridgeInternal());
    };
  }

  async configSaved(): Promise<void> {
    await this.#enqueue(() => this.#applyBridgeInternal());
  }

  #syncAutostartState(): void {
    if (!this.#autostart.supported) return;
    try {
      const enabled = this.#autostart.isEnabled();
      if (enabled !== this.#store.get().autostart) this.#store.setAutostart(enabled);
    } catch (error) {
      this.#logger.warn("app.autostart_read_failed", { error: errorMessage(error) });
    }
  }

  #loadInitialConfig(): void {
    try {
      this.#config = loadConfig(this.#configPath, { allowMissing: true });
    } catch (error) {
      this.#lastError = errorMessage(error);
      this.#config = structuredClone(DEFAULT_CONFIG);
      this.#logger.error("app.config_unreadable", { error: this.#lastError });
    }
  }

  async #startServer(configExists: boolean): Promise<void> {
    let backend: MidiBackend;
    try {
      backend = await NativeMidiBackend.create();
    } catch (error) {
      backend = new EmptyMidiBackend();
      this.#logger.warn("app.midi_unavailable", { error: errorMessage(error) });
    }
    const baseOptions = {
      configPath: this.#configPath,
      config: this.#config,
      demo: false,
      logger: this.#logger,
      autoDiscover: configExists,
      backend,
      app: this,
    };
    const server = new SettingsServer({ ...baseOptions, port: this.#settingsPort });
    try {
      await server.start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      this.#logger.warn("app.settings_port_busy", {
        port: this.#settingsPort,
        message: "Using a free port instead",
      });
      const fallback = new SettingsServer({ ...baseOptions, port: 0 });
      await fallback.start();
      this.#server = fallback;
      return;
    }
    this.#server = server;
  }

  async #applyBridgeInternal(): Promise<void> {
    await this.#stopBridgeInternal();
    this.#lastError = null;
    if (!existsSync(this.#configPath)) {
      this.#lastError = "Noch keine MIDI-Geräte eingerichtet.";
      return;
    }
    let config: BridgeConfig;
    try {
      config = loadConfig(this.#configPath);
      this.#config = config;
    } catch (error) {
      this.#lastError = errorMessage(error);
      this.#logger.warn("app.bridge_config_error", { error: this.#lastError });
      return;
    }
    if (!config.midi.devices.some((device) => device.enabled)) {
      this.#lastError = "Noch keine MIDI-Geräte eingerichtet.";
      return;
    }
    let bridge: Bridge | null = null;
    try {
      const needsUsb = config.midi.devices.some((device) => device.enabled && device.transport === "usb");
      const backend = await this.#backendFactory(needsUsb);
      bridge = new Bridge({ config, arming: this.#arming, backend, logger: this.#logger });
      await bridge.start();
      this.#bridge = bridge;
      this.#logger.info("app.bridge_started", {
        arming: this.#arming,
        fairlight: `${config.fairlight.host}:${config.fairlight.port}`,
      });
    } catch (error) {
      this.#lastError = errorMessage(error);
      this.#logger.error("app.bridge_start_failed", { error: this.#lastError });
      if (bridge) await bridge.stop().catch(() => undefined);
      this.#bridge = null;
    }
  }

  async #stopBridgeInternal(): Promise<void> {
    const bridge = this.#bridge;
    this.#bridge = null;
    if (!bridge) return;
    try {
      await bridge.stop();
    } catch (error) {
      this.#logger.warn("app.bridge_stop_failed", { error: errorMessage(error) });
    }
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
