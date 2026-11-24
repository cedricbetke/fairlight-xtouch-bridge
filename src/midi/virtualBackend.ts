import { MidiError } from "../errors.js";
import type {
  MidiBackend,
  MidiInputHandle,
  MidiOutputHandle,
  MidiPortInfo,
} from "./types.js";

interface VirtualDevice {
  inputName: string;
  outputName: string;
  present: boolean;
  inputListeners: Set<(message: number[]) => void>;
  outputListeners: Set<(message: number[]) => void>;
  sent: number[][];
}

export interface VirtualDeviceOptions {
  inputName: string;
  outputName?: string;
  allowDuplicateNames?: boolean;
}

export class VirtualMidiBackend implements MidiBackend {
  readonly kind = "virtual";
  readonly #devices: VirtualDevice[] = [];

  addDevice(options: VirtualDeviceOptions): void {
    if (
      !options.allowDuplicateNames &&
      this.#devices.some((device) => device.present && device.inputName === options.inputName)
    ) {
      throw new MidiError("VIRTUAL_PORT_EXISTS", `Virtual input ${options.inputName} already exists`);
    }
    this.#devices.push({
      inputName: options.inputName,
      outputName: options.outputName ?? options.inputName,
      present: true,
      inputListeners: new Set(),
      outputListeners: new Set(),
      sent: [],
    });
  }

  removeDevice(inputName: string): void {
    const device = this.#devices.find((entry) => entry.present && entry.inputName === inputName);
    if (!device) return;
    device.present = false;
    device.inputListeners.clear();
    device.outputListeners.clear();
  }

  /** Removes the present device at a port index, matching the index used by listInputs(). */
  removeDeviceAt(index: number): void {
    const device = this.#devices.filter((entry) => entry.present)[index];
    if (!device) return;
    device.present = false;
    device.inputListeners.clear();
    device.outputListeners.clear();
  }

  addDeviceBack(inputName: string): void {
    const device = this.#devices.find((entry) => entry.inputName === inputName);
    if (device) {
      device.present = true;
      return;
    }
    this.addDevice({ inputName });
  }

  injectInput(inputName: string, message: number[]): void {
    const device = this.#devices.find((entry) => entry.present && entry.inputName === inputName);
    if (!device) {
      throw new MidiError("VIRTUAL_PORT_MISSING", `Virtual input ${inputName} is not present`, { inputName });
    }
    for (const listener of [...device.inputListeners]) listener([...message]);
  }

  sentMessages(outputName: string): number[][] {
    const device = this.#devices.find((entry) => entry.outputName === outputName);
    return device ? device.sent.map((message) => [...message]) : [];
  }

  clearSent(outputName?: string): void {
    for (const device of this.#devices) {
      if (outputName === undefined || device.outputName === outputName) device.sent.length = 0;
    }
  }

  onOutput(outputName: string, listener: (message: number[]) => void): () => void {
    const device = this.#devices.find((entry) => entry.outputName === outputName);
    if (!device) {
      throw new MidiError("VIRTUAL_PORT_MISSING", `Virtual output ${outputName} is not present`, { outputName });
    }
    device.outputListeners.add(listener);
    return () => device.outputListeners.delete(listener);
  }

  listInputs(): MidiPortInfo[] {
    return this.#devices
      .filter((device) => device.present)
      .map((device, index) => ({ index, name: device.inputName }));
  }

  listOutputs(): MidiPortInfo[] {
    return this.#devices
      .filter((device) => device.present)
      .map((device, index) => ({ index, name: device.outputName }));
  }

  openInput(index: number): MidiInputHandle {
    const device = this.#presentDeviceAt(index);
    return {
      onMessage: (listener) => {
        device.inputListeners.add(listener);
      },
      close: () => {
        device.inputListeners.clear();
      },
    };
  }

  openOutput(index: number): MidiOutputHandle {
    const device = this.#presentDeviceAt(index);
    return {
      send: (message) => {
        if (!device.present) {
          throw new MidiError("VIRTUAL_PORT_GONE", `Virtual output ${device.outputName} was removed`);
        }
        const copy = [...message];
        device.sent.push(copy);
        for (const listener of [...device.outputListeners]) listener([...copy]);
      },
      close: () => {
        device.outputListeners.clear();
      },
    };
  }

  #presentDeviceAt(index: number): VirtualDevice {
    const device = this.#devices.filter((entry) => entry.present)[index];
    if (!device) {
      throw new MidiError("VIRTUAL_PORT_MISSING", `No virtual MIDI device at index ${index}`, { index });
    }
    return device;
  }
}
