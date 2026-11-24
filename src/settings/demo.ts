import { parseConfig, type BridgeConfig, type BusType } from "../config.js";

export interface DemoChannel {
  index: number;
  name: string;
}

export interface DemoBus {
  type: BusType;
  index: number;
  name: string;
  /** Sample readings for the preview; the real server includes live values. */
  meterDb?: number | null;
  integratedLufs?: number | null;
}

export interface DemoMonitor {
  index: number;
  name: string;
}

const DEMO_NAMES = [
  "Moderation",
  "Gast 1",
  "Gast 2",
  "Zuspieler",
  "Musik",
  "Telefon",
  "Raum",
  "Effekt",
  "Kamera 1",
  "Kamera 2",
  "Reporter 1",
  "Reporter 2",
  "Interview",
  "Atmo Bühne",
  "Atmo Saal",
  "Saal PA",
  "Regie",
  "Timecode",
  "Backup",
  "Stream",
  "Podcast",
  "Slide Audio",
  "VT 1",
  "VT 2",
  "Musik L",
  "Musik R",
  "DJ",
  "Off-Air",
  "Notfall",
  "Reserve 1",
  "Reserve 2",
  "Reserve 3",
  "Reserve 4",
  "Kamera 3",
  "Kamera 4",
  "Übersetzung",
  "Social Media",
  "Presse",
  "Foyer",
  "Parkplatz",
];

export const DEMO_CHANNELS: DemoChannel[] = DEMO_NAMES.map((name, index) => ({
  index: index + 1,
  name,
}));

export const DEMO_BUSES: DemoBus[] = [
  { type: "main", index: 1, name: "Main", meterDb: -6, integratedLufs: -23.1 },
  { type: "aux", index: 1, name: "Kopfhörer", meterDb: -12.4, integratedLufs: null },
  { type: "aux", index: 2, name: "Bühne", meterDb: -4.2, integratedLufs: null },
  { type: "mtx", index: 1, name: "Stream", meterDb: -2.1, integratedLufs: null },
  { type: "vca", index: 1, name: "Drums", meterDb: null, integratedLufs: null },
];

export const DEMO_MONITORS: DemoMonitor[] = [
  { index: 1, name: "Regie" },
  { index: 2, name: "Studio" },
  { index: 3, name: "Kopfhörer" },
  { index: 4, name: "Mobil" },
];

export function createDemoConfig(): BridgeConfig {
  return parseConfig({
    fairlight: {
      host: "127.0.0.1",
      port: 9000,
    },
    midi: {
      rescanIntervalMs: 2000,
      requireAllDevices: false,
      devices: [
        {
          role: "main",
          kind: "main",
          enabled: true,
          encoder: "pan",
          meters: true,
          input: "X-Touch INT",
          output: "X-Touch INT",
        },
        {
          role: "extender1",
          encoder: "pan",
          meters: true,
          enabled: true,
          input: { name: "X-Touch Extender", occurrence: 0 },
          output: { name: "X-Touch Extender", occurrence: 0 },
        },
        {
          role: "extender2",
          encoder: "pan",
          meters: true,
          enabled: true,
          input: { name: "X-Touch Extender", occurrence: 1 },
          output: { name: "X-Touch Extender", occurrence: 1 },
        },
      ],
    },
    mapping: {
      layout: {
        order: ["main", "extender1", "extender2"],
        surfaces: {
          main: {
            mode: "fixed",
            fixedTargets: [
              { kind: "channel", channel: 1 },
              { kind: "channel", channel: 2 },
              { kind: "channel", channel: 3 },
              { kind: "channel", channel: 4 },
              { kind: "channel", channel: 5 },
              { kind: "channel", channel: 6 },
              { kind: "channel", channel: 7 },
              { kind: "channel", channel: 8 },
            ],
          },
          extender1: { mode: "banking" },
          extender2: { mode: "banking" },
        },
      },
    },
    safety: {
      requireTouchForWrites: true,
      alignMotorsOnStart: true,
      alignMotorsOnBankChange: true,
      allowedWriteChannels: Array.from({ length: DEMO_CHANNELS.length }, (_, index) => index + 1),
      allowedWriteBuses: [],
      allowedWriteMonitors: DEMO_MONITORS.map((monitor) => monitor.index),
      maxWritesPerSecond: 20,
      writeExpiryMs: 250,
      feedbackEpsilonDb: 0.05,
    },
    logLevel: "info",
  });
}
