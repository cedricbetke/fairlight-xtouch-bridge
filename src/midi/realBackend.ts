import { MidiError } from "../errors.js";
import type {
  MidiBackend,
  MidiInputHandle,
  MidiOutputHandle,
  MidiPortInfo,
} from "./types.js";

interface NativeInput {
  on(event: "message", listener: (deltaTime: number, message: number[]) => void): void;
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  getPortCount(): number;
  getPortName(port: number): string;
  openPort(port: number): void;
  closePort(): void;
  destroy(): void;
}

interface NativeOutput {
  sendMessage(message: number[]): void;
  getPortCount(): number;
  getPortName(port: number): string;
  openPort(port: number): void;
  closePort(): void;
  destroy(): void;
}

interface NativeMidiModule {
  Input: new () => NativeInput;
  Output: new () => NativeOutput;
}

class NativeMidiInput implements MidiInputHandle {
  readonly #input: NativeInput;

  constructor(input: NativeInput) {
    this.#input = input;
  }

  onMessage(listener: (message: number[]) => void): void {
    this.#input.on("message", (_deltaTime, message) => {
      if (Array.isArray(message) && message.length > 0) listener([...message]);
    });
  }

  close(): void {
    try {
      this.#input.closePort();
    } finally {
      this.#input.destroy();
    }
  }
}

class NativeMidiOutput implements MidiOutputHandle {
  readonly #output: NativeOutput;

  constructor(output: NativeOutput) {
    this.#output = output;
  }

  send(message: number[]): void {
    this.#output.sendMessage(message);
  }

  close(): void {
    try {
      this.#output.closePort();
    } finally {
      this.#output.destroy();
    }
  }
}

export class NativeMidiBackend implements MidiBackend {
  readonly kind = "native";
  readonly #module: NativeMidiModule;

  constructor(module: NativeMidiModule) {
    this.#module = module;
  }

  static async create(): Promise<NativeMidiBackend> {
    try {
      const module = (await import("@julusian/midi/lazy")) as unknown as NativeMidiModule;
      return new NativeMidiBackend(module);
    } catch (error) {
      throw new MidiError(
        "MIDI_BACKEND_UNAVAILABLE",
        "The native MIDI backend could not be loaded",
        { cause: error instanceof Error ? error.message : String(error) },
        { cause: error },
      );
    }
  }

  listInputs(): MidiPortInfo[] {
    const input = new this.#module.Input();
    try {
      const count = input.getPortCount();
      const ports: MidiPortInfo[] = [];
      for (let index = 0; index < count; index += 1) {
        ports.push({ index, name: input.getPortName(index) });
      }
      return ports;
    } finally {
      input.destroy();
    }
  }

  listOutputs(): MidiPortInfo[] {
    const output = new this.#module.Output();
    try {
      const count = output.getPortCount();
      const ports: MidiPortInfo[] = [];
      for (let index = 0; index < count; index += 1) {
        ports.push({ index, name: output.getPortName(index) });
      }
      return ports;
    } finally {
      output.destroy();
    }
  }

  openInput(index: number): MidiInputHandle {
    const input = new this.#module.Input();
    try {
      input.ignoreTypes(false, true, true);
      input.openPort(index);
      return new NativeMidiInput(input);
    } catch (error) {
      input.destroy();
      throw new MidiError("MIDI_OPEN_INPUT_FAILED", `Cannot open MIDI input ${index}`, { index }, { cause: error });
    }
  }

  openOutput(index: number): MidiOutputHandle {
    const output = new this.#module.Output();
    try {
      output.openPort(index);
      return new NativeMidiOutput(output);
    } catch (error) {
      output.destroy();
      throw new MidiError("MIDI_OPEN_OUTPUT_FAILED", `Cannot open MIDI output ${index}`, { index }, { cause: error });
    }
  }
}
