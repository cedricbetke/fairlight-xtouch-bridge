import type { MidiConfig, MidiDeviceConfig, SurfaceRole } from "../config.js";
import { MidiError } from "../errors.js";
import type { Logger } from "../logger.js";
import { RtpMidiSession, type RtpMidiSessionEvent, type RtpMidiSessionLike } from "./rtpMidiSession.js";
import type { MidiBackend, MidiInputHandle, MidiOutputHandle, MidiPortInfo, PortSelector, PortResolution } from "./types.js";

export interface MidiPortsSnapshot {
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
}

export type MidiDeviceEvent =
  | {
      type: "online";
      role: SurfaceRole;
      inputName: string;
      outputName: string;
      inputIndex: number;
      outputIndex: number;
    }
  | { type: "offline"; role: SurfaceRole; reason: string }
  | { type: "midi"; role: SurfaceRole; message: number[] };

export interface MidiDeviceStatus {
  role: SurfaceRole;
  enabled: boolean;
  online: boolean;
  inputName: string | null;
  outputName: string | null;
  inputIndex: number | null;
  outputIndex: number | null;
  reason: string | null;
  quarantined: boolean;
}

type MidiDeviceEventListener = (event: MidiDeviceEvent) => void;

export interface MidiDeviceManagerOptions {
  /** Overrides the AppleMIDI transport, mainly for tests. */
  createRtpMidiSession?: (device: MidiDeviceConfig) => RtpMidiSessionLike;
}

interface OpenDevice {
  config: MidiDeviceConfig;
  input: MidiInputHandle;
  output: MidiOutputHandle;
  inputIndex: number;
  outputIndex: number;
  inputName: string;
  outputName: string;
}

interface PortFingerprint {
  inputs: number[];
  outputs: number[];
  /** Number of present physical ports, approximated by the larger direction count. */
  count: number;
}

function duplicatePortNames(devices: readonly MidiDeviceConfig[]): Set<string> {
  const rolesByName = new Map<string, Set<SurfaceRole>>();
  for (const device of devices) {
    if (!device.enabled || device.transport === "network") continue;
    for (const name of [device.input.name, device.output.name]) {
      const roles = rolesByName.get(name) ?? new Set<SurfaceRole>();
      roles.add(device.role);
      rolesByName.set(name, roles);
    }
  }
  const duplicates = new Set<string>();
  for (const [name, roles] of rolesByName) {
    if (roles.size > 1) duplicates.add(name);
  }
  return duplicates;
}

function portFingerprint(inputs: readonly MidiPortInfo[], outputs: readonly MidiPortInfo[], name: string): PortFingerprint {
  const inputIndexes = inputs
    .filter((port) => port.name === name)
    .map((port) => port.index)
    .sort((a, b) => a - b);
  const outputIndexes = outputs
    .filter((port) => port.name === name)
    .map((port) => port.index)
    .sort((a, b) => a - b);
  return {
    inputs: inputIndexes,
    outputs: outputIndexes,
    count: Math.max(inputIndexes.length, outputIndexes.length),
  };
}

function sameFingerprint(a: PortFingerprint, b: PortFingerprint): boolean {
  return a.inputs.join(",") === b.inputs.join(",") && a.outputs.join(",") === b.outputs.join(",");
}

export function resolvePort(ports: readonly MidiPortInfo[], selector: PortSelector): PortResolution {
  const matches = ports.filter((port) => port.name === selector.name);
  if (matches.length === 0) {
    return { ok: false, reason: `MIDI port "${selector.name}" not found` };
  }
  const selected = matches[selector.occurrence];
  if (!selected) {
    return {
      ok: false,
      reason: `MIDI port "${selector.name}" occurrence ${selector.occurrence} not found (${matches.length} match(es))`,
    };
  }
  return { ok: true, port: { info: selected, selector } };
}

export class MidiDeviceManager {
  readonly #config: MidiConfig;
  readonly #backend: MidiBackend;
  readonly #logger: Logger;
  readonly #devices = new Map<SurfaceRole, OpenDevice>();
  readonly #reasons = new Map<SurfaceRole, string>();
  readonly #listeners = new Set<MidiDeviceEventListener>();
  readonly #guardedNames: Set<string>;
  readonly #fingerprints = new Map<string, PortFingerprint>();
  readonly #everOnline = new Set<SurfaceRole>();
  readonly #quarantined = new Set<SurfaceRole>();
  readonly #quarantineReasons = new Map<SurfaceRole, string>();
  readonly #createSession: (device: MidiDeviceConfig) => RtpMidiSessionLike;
  readonly #network = new Map<SurfaceRole, RtpMidiSessionLike>();
  readonly #networkUnsubs = new Map<SurfaceRole, () => void>();
  readonly #networkReasons = new Map<SurfaceRole, string>();
  readonly #networkOnline = new Set<SurfaceRole>();
  #timer: NodeJS.Timeout | undefined;
  #lastPorts: MidiPortsSnapshot = { inputs: [], outputs: [] };
  #stopped = true;

  constructor(
    config: MidiConfig,
    backend: MidiBackend,
    logger: Logger,
    options: MidiDeviceManagerOptions = {},
  ) {
    this.#config = config;
    this.#backend = backend;
    this.#logger = logger.child({ component: "midi" });
    this.#guardedNames = duplicatePortNames(config.devices);
    this.#createSession =
      options.createRtpMidiSession ??
      ((device) => {
        const endpoint = device.network;
        if (!endpoint) throw new MidiError("NETWORK_ENDPOINT_MISSING", `Network endpoint for ${device.role} is missing`);
        return new RtpMidiSession({
          host: endpoint.host,
          port: endpoint.port,
          name: device.name ?? `Fairlight Bridge (${device.role})`,
          logger: this.#logger,
        });
      });
  }

  onEvent(listener: MidiDeviceEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#syncNetworkDevices();
    this.scan();
    this.#timer = setInterval(() => this.scan(), this.#config.rescanIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    for (const role of [...this.#network.keys()]) {
      const session = this.#network.get(role);
      this.#networkUnsubs.get(role)?.();
      this.#networkUnsubs.delete(role);
      this.#network.delete(role);
      this.#networkReasons.set(role, "bridge stopped");
      void session?.stop();
    }
    for (const role of [...this.#devices.keys()]) {
      this.#closeDevice(role, "bridge stopped");
    }
  }

  scan(): MidiPortsSnapshot {
    this.#syncNetworkDevices();
    let inputs: MidiPortInfo[] = [];
    let outputs: MidiPortInfo[] = [];
    try {
      inputs = this.#backend.listInputs();
      outputs = this.#backend.listOutputs();
    } catch (error) {
      this.#logger.error("midi.port_scan_failed", { error });
      for (const device of this.#config.devices) {
        if (this.#quarantined.has(device.role) || device.transport === "network") continue;
        this.#markOffline(device.role, "MIDI port scan failed");
      }
      return { inputs, outputs };
    }
    this.#lastPorts = { inputs, outputs };

    const enabled = this.#config.devices.filter(
      (device) => device.enabled && device.transport !== "network",
    );
    this.#guardDuplicatePorts(inputs, outputs);
    for (const device of this.#config.devices) {
      if (device.transport === "network") continue;
      if (!device.enabled) this.#closeDevice(device.role, "device disabled");
    }

    const resolved = new Map<
      SurfaceRole,
      { config: MidiDeviceConfig; input: MidiPortInfo; output: MidiPortInfo }
    >();
    for (const device of enabled) {
      if (this.#quarantined.has(device.role)) continue;
      const input = resolvePort(inputs, device.input);
      const output = resolvePort(outputs, device.output);
      if (!input.ok) {
        this.#markOffline(device.role, input.reason);
        continue;
      }
      if (!output.ok) {
        this.#markOffline(device.role, output.reason);
        continue;
      }
      resolved.set(device.role, { config: device, input: input.port.info, output: output.port.info });
    }

    const inputOwners = new Map<number, SurfaceRole>();
    const outputOwners = new Map<number, SurfaceRole>();
    for (const [role, entry] of resolved) {
      const inputOwner = inputOwners.get(entry.input.index);
      const outputOwner = outputOwners.get(entry.output.index);
      if (inputOwner || outputOwner) {
        this.#markOffline(
          role,
          `MIDI port already assigned to ${inputOwner ?? outputOwner} (input ${entry.input.index}, output ${entry.output.index})`,
        );
        resolved.delete(role);
        continue;
      }
      inputOwners.set(entry.input.index, role);
      outputOwners.set(entry.output.index, role);
    }

    for (const [role, entry] of resolved) {
      const existing = this.#devices.get(role);
      if (
        existing &&
        existing.inputIndex === entry.input.index &&
        existing.outputIndex === entry.output.index
      ) {
        this.#reasons.delete(role);
        continue;
      }
      if (existing) {
        this.#closeDevice(role, "MIDI ports changed");
      }
      try {
        this.#openDevice(entry.config, entry.input, entry.output);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#markOffline(role, reason);
        this.#logger.error("midi.open_failed", { role, error });
      }
    }

    for (const role of [...this.#devices.keys()]) {
      if (!resolved.has(role)) {
        const reason = this.#reasons.get(role) ?? "MIDI device unavailable";
        this.#closeDevice(role, reason);
      }
    }

    return { inputs, outputs };
  }

  send(role: SurfaceRole, message: number[]): boolean {
    if (this.#quarantined.has(role)) {
      this.#logger.debug("midi.send_quarantined", { role });
      return false;
    }
    const session = this.#network.get(role);
    if (session) return session.online && session.send(message);
    const device = this.#devices.get(role);
    if (!device) {
      this.#logger.debug("midi.send_offline", { role });
      return false;
    }
    try {
      device.output.send(message);
      return true;
    } catch (error) {
      this.#logger.error("midi.send_failed", { role, error });
      this.#closeDevice(role, "MIDI output failed");
      return false;
    }
  }

  statuses(): MidiDeviceStatus[] {
    return this.#config.devices.map((device) => {
      if (device.transport === "network") {
        const endpoint = device.network ? `${device.network.host}:${device.network.port}` : null;
        const session = this.#network.get(device.role);
        return {
          role: device.role,
          enabled: device.enabled,
          online: session?.online ?? false,
          inputName: endpoint,
          outputName: endpoint,
          inputIndex: null,
          outputIndex: null,
          reason: session
            ? session.reason
            : (this.#networkReasons.get(device.role) ?? (device.enabled ? "connecting" : "disabled")),
          quarantined: false,
        };
      }
      const open = this.#devices.get(device.role);
      return {
        role: device.role,
        enabled: device.enabled,
        online: open !== undefined,
        inputName: open?.inputName ?? null,
        outputName: open?.outputName ?? null,
        inputIndex: open?.inputIndex ?? null,
        outputIndex: open?.outputIndex ?? null,
        reason: open
          ? null
          : (this.#quarantineReasons.get(device.role) ??
            this.#reasons.get(device.role) ??
            (device.enabled ? null : "disabled")),
        quarantined: this.#quarantined.has(device.role),
      };
    });
  }

  lastPorts(): MidiPortsSnapshot {
    return this.#lastPorts;
  }

  /**
   * Duplicate port names cannot be re-bound safely after a rescan: the backend exposes
   * only the port name and its current list index, with no stable CoreMIDI endpoint id.
   * Two identical units can therefore swap identity when the list shifts. Once such a
   * name has been used by an online role, any change locks those roles until restart.
   */
  #guardDuplicatePorts(inputs: readonly MidiPortInfo[], outputs: readonly MidiPortInfo[]): void {
    for (const name of this.#guardedNames) {
      const current = portFingerprint(inputs, outputs, name);
      const baseline = this.#fingerprints.get(name);
      if (!baseline) {
        this.#fingerprints.set(name, current);
        continue;
      }
      if (sameFingerprint(baseline, current)) continue;
      this.#fingerprints.set(name, current);

      const roles = this.#config.devices
        .filter(
          (device) =>
            device.enabled &&
            device.transport !== "network" &&
            (device.input.name === name || device.output.name === name),
        )
        .map((device) => device.role);
      if (!roles.some((role) => this.#everOnline.has(role))) continue;

      const affected = roles.filter((role) => !this.#quarantined.has(role));
      if (affected.length === 0) continue;
      const reason = `duplicate port name "${name}" changed (${baseline.count} -> ${current.count} ports); verify the port order and restart the bridge`;
      for (const role of affected) {
        this.#quarantined.add(role);
        this.#quarantineReasons.set(role, reason);
      }
      for (const role of affected) this.#markOffline(role, reason);
      this.#logger.warn("midi.duplicate_ports_changed", {
        name,
        before: baseline,
        after: current,
        roles: affected,
      });
    }
  }

  #syncNetworkDevices(): void {
    for (const device of this.#config.devices) {
      if (device.transport !== "network") continue;
      if (!device.enabled) {
        this.#stopNetwork(device.role, "device disabled");
        continue;
      }
      if (!device.network) {
        this.#networkReasons.set(device.role, "network endpoint missing");
        continue;
      }
      if (this.#network.has(device.role)) continue;
      this.#startNetwork(device);
    }
  }

  #startNetwork(device: MidiDeviceConfig): void {
    let session: RtpMidiSessionLike;
    try {
      session = this.#createSession(device);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#networkReasons.set(device.role, reason);
      this.#logger.error("midi.network_open_failed", { role: device.role, error });
      return;
    }
    const role = device.role;
    const endpoint = device.network ? `${device.network.host}:${device.network.port}` : "unknown";
    this.#network.set(role, session);
    this.#networkUnsubs.set(
      role,
      session.onEvent((event) => {
        if (this.#network.get(role) !== session) return;
        this.#handleNetworkEvent(device, endpoint, event);
      }),
    );
    this.#networkReasons.set(role, "connecting");
    this.#logger.info("midi.network_connecting", { role, endpoint });
    session.start();
  }

  #handleNetworkEvent(device: MidiDeviceConfig, endpoint: string, event: RtpMidiSessionEvent): void {
    const role = device.role;
    if (event.type === "online") {
      this.#networkReasons.delete(role);
      this.#networkOnline.add(role);
      this.#logger.info("midi.network_online", { role, endpoint });
      this.#emit({
        type: "online",
        role,
        inputName: endpoint,
        outputName: endpoint,
        inputIndex: -1,
        outputIndex: -1,
      });
      return;
    }
    if (event.type === "offline") {
      const wasOnline = this.#networkOnline.delete(role);
      this.#networkReasons.set(role, event.reason);
      if (wasOnline) {
        this.#logger.warn("midi.network_offline", { role, endpoint, reason: event.reason });
        this.#emit({ type: "offline", role, reason: event.reason });
      } else {
        this.#logger.debug("midi.network_unavailable", { role, endpoint, reason: event.reason });
      }
      return;
    }
    this.#emit({ type: "midi", role, message: event.message });
  }

  #stopNetwork(role: SurfaceRole, reason: string): void {
    const session = this.#network.get(role);
    if (!session) {
      this.#networkReasons.set(role, reason);
      return;
    }
    this.#networkUnsubs.get(role)?.();
    this.#networkUnsubs.delete(role);
    this.#network.delete(role);
    const wasOnline = this.#networkOnline.delete(role);
    this.#networkReasons.set(role, reason);
    void session.stop();
    if (wasOnline) this.#emit({ type: "offline", role, reason });
  }

  #openDevice(config: MidiDeviceConfig, input: MidiPortInfo, output: MidiPortInfo): void {
    let inputHandle: MidiInputHandle | undefined;
    let outputHandle: MidiOutputHandle | undefined;
    try {
      inputHandle = this.#backend.openInput(input.index);
      outputHandle = this.#backend.openOutput(output.index);
      inputHandle.onMessage((message) => {
        if (this.#devices.get(config.role)?.input !== inputHandle) return;
        this.#emit({ type: "midi", role: config.role, message });
      });
      this.#devices.set(config.role, {
        config,
        input: inputHandle,
        output: outputHandle,
        inputIndex: input.index,
        outputIndex: output.index,
        inputName: input.name,
        outputName: output.name,
      });
      this.#reasons.delete(config.role);
      this.#everOnline.add(config.role);
      this.#logger.info("midi.device_online", {
        role: config.role,
        input: input.name,
        inputIndex: input.index,
        output: output.name,
        outputIndex: output.index,
      });
      this.#emit({
        type: "online",
        role: config.role,
        inputName: input.name,
        outputName: output.name,
        inputIndex: input.index,
        outputIndex: output.index,
      });
    } catch (error) {
      try {
        inputHandle?.close();
      } catch {}
      try {
        outputHandle?.close();
      } catch {}
      throw error instanceof MidiError ? error : new MidiError("MIDI_OPEN_FAILED", "Cannot open MIDI device", {}, { cause: error });
    }
  }

  #closeDevice(role: SurfaceRole, reason: string): void {
    const device = this.#devices.get(role);
    if (!device) {
      if (this.#reasons.get(role) !== reason) {
        this.#reasons.set(role, reason);
        this.#logger.debug("midi.device_offline", { role, reason });
        this.#emit({ type: "offline", role, reason });
      }
      return;
    }
    this.#devices.delete(role);
    try {
      device.input.close();
    } catch (error) {
      this.#logger.warn("midi.close_input_failed", { role, error });
    }
    try {
      device.output.close();
    } catch (error) {
      this.#logger.warn("midi.close_output_failed", { role, error });
    }
    this.#reasons.set(role, reason);
    this.#logger.info("midi.device_offline", { role, reason });
    this.#emit({ type: "offline", role, reason });
  }

  #markOffline(role: SurfaceRole, reason: string): void {
    if (this.#devices.has(role)) {
      this.#closeDevice(role, reason);
      return;
    }
    if (this.#reasons.get(role) === reason) return;
    this.#reasons.set(role, reason);
    this.#logger.debug("midi.device_offline", { role, reason });
    this.#emit({ type: "offline", role, reason });
  }

  #emit(event: MidiDeviceEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.#logger.error("midi.listener_failed", { error });
      }
    }
  }
}
