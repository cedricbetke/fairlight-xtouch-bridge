import type { MidiConfig, MidiDeviceConfig, SurfaceRole } from "../config.js";
import { MidiError } from "../errors.js";
import type { Logger } from "../logger.js";
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
}

type MidiDeviceEventListener = (event: MidiDeviceEvent) => void;

interface OpenDevice {
  config: MidiDeviceConfig;
  input: MidiInputHandle;
  output: MidiOutputHandle;
  inputIndex: number;
  outputIndex: number;
  inputName: string;
  outputName: string;
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
  #timer: NodeJS.Timeout | undefined;
  #lastPorts: MidiPortsSnapshot = { inputs: [], outputs: [] };
  #stopped = true;

  constructor(config: MidiConfig, backend: MidiBackend, logger: Logger) {
    this.#config = config;
    this.#backend = backend;
    this.#logger = logger.child({ component: "midi" });
  }

  onEvent(listener: MidiDeviceEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
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
    for (const role of [...this.#devices.keys()]) {
      this.#closeDevice(role, "bridge stopped");
    }
  }

  scan(): MidiPortsSnapshot {
    let inputs: MidiPortInfo[] = [];
    let outputs: MidiPortInfo[] = [];
    try {
      inputs = this.#backend.listInputs();
      outputs = this.#backend.listOutputs();
    } catch (error) {
      this.#logger.error("midi.port_scan_failed", { error });
      for (const device of this.#config.devices) {
        this.#markOffline(device.role, "MIDI port scan failed");
      }
      return { inputs, outputs };
    }
    this.#lastPorts = { inputs, outputs };

    const enabled = this.#config.devices.filter(
      (device) => device.enabled && device.transport !== "network",
    );
    for (const device of this.#config.devices) {
      if (!device.enabled) this.#closeDevice(device.role, "device disabled");
      else if (device.transport === "network") {
        this.#closeDevice(device.role, "network transport not active yet");
      }
    }

    const resolved = new Map<
      SurfaceRole,
      { config: MidiDeviceConfig; input: MidiPortInfo; output: MidiPortInfo }
    >();
    for (const device of enabled) {
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
      const open = this.#devices.get(device.role);
      return {
        role: device.role,
        enabled: device.enabled,
        online: open !== undefined,
        inputName: open?.inputName ?? null,
        outputName: open?.outputName ?? null,
        inputIndex: open?.inputIndex ?? null,
        outputIndex: open?.outputIndex ?? null,
        reason: open ? null : (this.#reasons.get(device.role) ?? (device.enabled ? null : "disabled")),
      };
    });
  }

  lastPorts(): MidiPortsSnapshot {
    return this.#lastPorts;
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
