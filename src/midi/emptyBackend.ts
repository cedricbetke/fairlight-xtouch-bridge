import { MidiError } from "../errors.js";
import type { MidiBackend, MidiInputHandle, MidiOutputHandle, MidiPortInfo } from "./types.js";

/**
 * Placeholder for configurations that use network transports only. It keeps
 * the bridge startable on machines without the native USB MIDI module.
 */
export class EmptyMidiBackend implements MidiBackend {
  readonly kind = "empty";

  listInputs(): MidiPortInfo[] {
    return [];
  }

  listOutputs(): MidiPortInfo[] {
    return [];
  }

  openInput(): MidiInputHandle {
    throw new MidiError("MIDI_BACKEND_UNAVAILABLE", "No USB MIDI backend is active");
  }

  openOutput(): MidiOutputHandle {
    throw new MidiError("MIDI_BACKEND_UNAVAILABLE", "No USB MIDI backend is active");
  }
}
