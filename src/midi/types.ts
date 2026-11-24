export interface MidiPortInfo {
  index: number;
  name: string;
}

export interface MidiInputHandle {
  onMessage(listener: (message: number[]) => void): void;
  close(): void;
}

export interface MidiOutputHandle {
  send(message: number[]): void;
  close(): void;
}

export interface MidiBackend {
  readonly kind: string;
  listInputs(): MidiPortInfo[];
  listOutputs(): MidiPortInfo[];
  openInput(index: number): MidiInputHandle;
  openOutput(index: number): MidiOutputHandle;
}

export type PortSelector = {
  name: string;
  occurrence: number;
};

export interface ResolvedPort {
  info: MidiPortInfo;
  selector: PortSelector;
}

export type PortResolution =
  | { ok: true; port: ResolvedPort }
  | { ok: false; reason: string };
