import type { BusType } from "../config.js";

export interface SendState {
  type: "aux";
  index: number;
  levelDb: number | null;
  muted: boolean | null;
  pan: number | null;
  writableLevel: boolean;
  writableMute: boolean;
  writablePan: boolean;
}

export interface ChannelState {
  index: number;
  name: string;
  levelDb: number | null;
  muted: boolean | null;
  pan: number | null;
  meterDb: number | null;
  sends: Record<string, SendState>;
  writableLevel: boolean;
  writableMute: boolean;
  writablePan: boolean;
}

export interface BusState {
  type: BusType;
  index: number;
  name: string;
  levelDb: number | null;
  muted: boolean | null;
  pan: number | null;
  meterDb: number | null;
  /** Integrated loudness in LUFS. Only main buses with a `meters` container expose it. */
  integratedLufs: number | null;
  writableLevel: boolean;
  writableMute: boolean;
  writablePan: boolean;
}

export interface MonitorState {
  index: number;
  name: string;
  levelDb: number | null;
  muted: boolean | null;
  dimmed: boolean | null;
  writableLevel: boolean;
  writableMute: boolean;
  writableDim: boolean;
}

export interface FairlightSnapshot {
  revision: number;
  discoveredAt: string;
  /** Fairlight's on-air state. `null` means unknown. */
  onAir: boolean | null;
  channels: ChannelState[];
  buses: BusState[];
  monitors: MonitorState[];
}

export type ChannelField = "level" | "mute" | "name" | "pan" | "meter" | "send";
export type BusField = "level" | "mute" | "name" | "pan" | "meter" | "integrated";
export type MonitorField = "level" | "mute" | "dim" | "name";

export interface StructureChangeSummary {
  addedChannels: number[];
  removedChannels: number[];
  renamedChannels: Array<{ index: number; before: string; after: string }>;
  addedBuses: string[];
  removedBuses: string[];
}

export type FairlightEvent =
  | { type: "connected"; snapshot: FairlightSnapshot }
  | { type: "disconnected"; reason: string }
  | { type: "snapshot"; snapshot: FairlightSnapshot }
  | { type: "system"; onAir: boolean | null }
  | { type: "channel"; channel: ChannelState; changed: ChannelField[] }
  | { type: "bus"; bus: BusState; changed: BusField[] }
  | { type: "monitor"; monitor: MonitorState; changed: MonitorField[] }
  | { type: "structure-change-detected"; reason: string }
  | { type: "structure-changed"; summary: StructureChangeSummary }
  | { type: "structure-revalidated" }
  | { type: "warning"; message: string };

export type FairlightEventListener = (event: FairlightEvent) => void;

export interface FairlightClient {
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  snapshot(): FairlightSnapshot;
  setChannelLevel(index: number, db: number): Promise<number>;
  setChannelMute(index: number, muted: boolean): Promise<boolean>;
  setChannelPan(index: number, pan: number): Promise<number>;
  setChannelSendLevel(index: number, auxIndex: number, db: number): Promise<number>;
  setBusLevel(type: BusType, index: number, db: number): Promise<number>;
  setBusMute(type: BusType, index: number, muted: boolean): Promise<boolean>;
  setBusPan(type: BusType, index: number, pan: number): Promise<number>;
  setMonitorDim(index: number, dimmed: boolean): Promise<boolean>;
  onEvent(listener: FairlightEventListener): () => void;
}

export function cloneChannel(channel: ChannelState): ChannelState {
  return {
    ...channel,
    sends: Object.fromEntries(Object.entries(channel.sends ?? {}).map(([key, send]) => [key, { ...send }])),
  };
}

export function cloneBus(bus: BusState): BusState {
  return { ...bus };
}

export function cloneMonitor(monitor: MonitorState): MonitorState {
  return { ...monitor };
}

export function cloneSnapshot(snapshot: FairlightSnapshot): FairlightSnapshot {
  return {
    ...snapshot,
    onAir: snapshot.onAir,
    channels: snapshot.channels.map(cloneChannel),
    buses: snapshot.buses.map(cloneBus),
    monitors: snapshot.monitors.map(cloneMonitor),
  };
}

export function busKey(type: BusType, index: number): string {
  return `${type}:${index}`;
}

export function auxSendKey(index: number): string {
  return `aux:${index}`;
}
