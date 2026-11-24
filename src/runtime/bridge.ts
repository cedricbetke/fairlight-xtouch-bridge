import { configuredAuxTargets, configuredMonitorTargets, type BridgeConfig, type RuntimeArming } from "../config.js";
import { EmberFairlightClient } from "../fairlight/emberClient.js";
import type { FairlightClient } from "../fairlight/types.js";
import type { Logger } from "../logger.js";
import { MidiDeviceManager, type MidiDeviceStatus } from "../midi/deviceManager.js";
import type { MidiBackend } from "../midi/types.js";
import { SyncEngine, type SyncEngineStatus } from "../sync/engine.js";

export interface BridgeOptions {
  config: BridgeConfig;
  arming: RuntimeArming;
  backend: MidiBackend;
  logger: Logger;
  fairlight?: FairlightClient;
}

export interface BridgeStatus {
  devices: MidiDeviceStatus[];
  sync: SyncEngineStatus;
}

export class Bridge {
  readonly #config: BridgeConfig;
  readonly #logger: Logger;
  readonly #fairlight: FairlightClient;
  readonly #midi: MidiDeviceManager;
  readonly #sync: SyncEngine;
  #keepAlive: NodeJS.Timeout | undefined;
  #statusTimer: NodeJS.Timeout | undefined;
  #started = false;

  constructor(options: BridgeOptions) {
    this.#config = options.config;
    this.#logger = options.logger.child({ component: "bridge" });
    this.#fairlight = options.fairlight ?? new EmberFairlightClient({
      ...options.config.fairlight,
      autoReconnect: true,
      logger: options.logger,
      subscribeMeters: options.config.midi.devices.some((device) => device.meters),
      watchChannelNames:
        options.config.mapping.singleChannel === null
          ? []
          : [options.config.mapping.singleChannel],
      watchAuxSends: configuredAuxTargets(options.config.mapping),
      watchMonitors: configuredMonitorTargets(options.config.mapping),
    });
    this.#midi = new MidiDeviceManager(options.config.midi, options.backend, options.logger);
    this.#sync = new SyncEngine({
      config: options.config,
      arming: options.arming,
      fairlight: this.#fairlight,
      midi: { send: (role, message) => this.#midi.send(role, message) },
      logger: options.logger,
    });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#sync.start();
    this.#midi.onEvent((event) => this.#sync.handleDeviceEvent(event));
    this.#midi.start();
    this.#keepAlive = setInterval(() => undefined, 1000);
    this.#statusTimer = setInterval(() => {
      this.#logger.debug("bridge.status", { status: this.status() });
    }, 30_000);
    await this.#fairlight.connect();
    const missing = this.#midi.statuses().filter((status) => status.enabled && !status.online);
    if (missing.length > 0) {
      this.#logger.warn("bridge.midi_devices_offline", { devices: missing });
    }
    if (this.#config.midi.requireAllDevices && missing.length > 0) {
      this.#logger.warn("bridge.require_all_devices_not_met", { count: missing.length });
    }
    this.#logger.info("bridge.started", {
      arming: this.#config.safety,
      fairlight: `${this.#config.fairlight.host}:${this.#config.fairlight.port}`,
      midiDevices: this.#midi.statuses(),
    });
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    if (this.#statusTimer) {
      clearInterval(this.#statusTimer);
      this.#statusTimer = undefined;
    }
    if (this.#keepAlive) {
      clearInterval(this.#keepAlive);
      this.#keepAlive = undefined;
    }
    this.#midi.stop();
    this.#sync.stop();
    await this.#fairlight.disconnect();
    this.#logger.info("bridge.stopped");
  }

  status(): BridgeStatus {
    return {
      devices: this.#midi.statuses(),
      sync: this.#sync.status(),
    };
  }
}
