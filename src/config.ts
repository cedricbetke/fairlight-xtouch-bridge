import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigError } from "./errors.js";
import { isLcdColor, type LcdColor } from "./lcd/colors.js";
import { isLogLevel, type LogLevel } from "./logger.js";
import { BUTTON_IDS, isButtonId, type ButtonId } from "./mcu/buttons.js";

export { BUTTON_IDS };
export type { ButtonId };

export const SURFACE_ROLES = ["main", "extender1", "extender2"] as const;
export type SurfaceRole = string;
export type SurfaceKind = "main" | "extender";
export const SURFACE_KINDS = ["main", "extender"] as const;
export const SURFACE_ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export function isSurfaceRoleId(value: string): boolean {
  return SURFACE_ROLE_PATTERN.test(value);
}

export function mainRoleOf(devices: readonly MidiDeviceConfig[]): SurfaceRole {
  return (
    devices.find((device) => device.kind === "main" && device.enabled)?.role ??
    devices.find((device) => device.kind === "main")?.role ??
    devices[0]?.role ??
    "main"
  );
}

export const SURFACE_MODES = ["fixed", "banking"] as const;
export type SurfaceMode = (typeof SURFACE_MODES)[number];

export const ENCODER_MODES = ["off", "pan"] as const;
export type EncoderMode = (typeof ENCODER_MODES)[number];

export const BUS_TYPES = ["main", "sub", "aux", "mixm", "mtx", "vca"] as const;
export type BusType = (typeof BUS_TYPES)[number];

export const LCD_LINE_MODES = [
  "name",
  "custom",
  "type-number",
  "type",
  "number",
  "value",
  "target",
  "blank",
] as const;
export type LcdLineMode = (typeof LCD_LINE_MODES)[number];

export const LCD_PALETTE_KEYS = ["channel", ...BUS_TYPES] as const;
export type LcdPaletteKey = (typeof LCD_PALETTE_KEYS)[number];

export type LcdPaletteConfig = Record<LcdPaletteKey, LcdColor>;

export interface LcdOverrideConfig {
  target: FixedTargetConfig;
  color: LcdColor | "auto";
  name: string | null;
  expectedName: string | null;
}

export interface LcdConfig {
  colorsEnabled: boolean;
  line1: LcdLineMode;
  line2: LcdLineMode;
  palette: LcdPaletteConfig;
  overrides: LcdOverrideConfig[];
}

export function defaultLcdConfig(): LcdConfig {
  return {
    colorsEnabled: true,
    line1: "custom",
    line2: "type-number",
    palette: {
      channel: "white",
      main: "red",
      sub: "blue",
      aux: "cyan",
      mixm: "magenta",
      mtx: "yellow",
      vca: "green",
    },
    overrides: [],
  };
}

export function fixedTargetKey(target: FixedTargetConfig): string {
  return target.kind === "channel" ? `channel:${target.channel}` : `bus:${target.busType}:${target.index}`;
}

export interface FixedChannelTargetConfig {
  kind: "channel";
  channel: number;
}

export interface FixedBusTargetConfig {
  kind: "bus";
  busType: BusType;
  index: number;
}

export type FixedTargetConfig = FixedChannelTargetConfig | FixedBusTargetConfig;

export interface SurfaceAssignmentConfig {
  mode: SurfaceMode;
  fixedTargets: Array<FixedTargetConfig | null>;
}

export interface LayoutConfig {
  order: SurfaceRole[];
  surfaces: Record<SurfaceRole, SurfaceAssignmentConfig>;
}

export function defaultLayout(): LayoutConfig {
  return {
    order: [...SURFACE_ROLES],
    surfaces: {
      main: { mode: "banking", fixedTargets: [] },
      extender1: { mode: "banking", fixedTargets: [] },
      extender2: { mode: "banking", fixedTargets: [] },
    },
  };
}

export interface MidiPortSelector {
  name: string;
  occurrence: number;
}

export const MIDI_TRANSPORTS = ["usb", "network"] as const;
export type MidiTransport = (typeof MIDI_TRANSPORTS)[number];

export const DEFAULT_NETWORK_PORT = 5004;

export interface MidiNetworkConfig {
  host: string;
  port: number;
}

export interface MidiDeviceConfig {
  role: SurfaceRole;
  kind: SurfaceKind;
  name: string | null;
  enabled: boolean;
  transport: MidiTransport;
  input: MidiPortSelector;
  output: MidiPortSelector;
  network: MidiNetworkConfig | null;
  encoder: EncoderMode;
  meters: boolean;
}

export interface FairlightConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  reconnectAttempts: number;
}

export interface MasterMappingConfig {
  enabled: boolean;
  busType: BusType;
  busIndex: number;
}

export interface SendsOnFaderConfig {
  enabled: boolean;
  busIndex: number;
}

export interface SendsOnFaderAssignment {
  type: "sends-on-fader";
  auxIndex: number;
}

export interface MonitorDimAssignment {
  type: "monitor-dim";
  monitorIndex: number;
}

export type ButtonAssignmentConfig = SendsOnFaderAssignment | MonitorDimAssignment;

export interface MappingConfig {
  bankStep: number;
  singleChannel: number | null;
  singleChannelName: string | null;
  master: MasterMappingConfig;
  sendsOnFader: SendsOnFaderConfig;
  buttonAssignments: Partial<Record<ButtonId, ButtonAssignmentConfig>>;
  layout: LayoutConfig | null;
}

export interface SafetyConfig {
  requireTouchForWrites: boolean;
  alignMotorsOnStart: boolean;
  alignMotorsOnBankChange: boolean;
  allowedWriteChannels: number[];
  allowedWriteBuses: string[];
  allowedWriteMonitors: number[];
  maxWritesPerSecond: number;
  writeExpiryMs: number;
  feedbackEpsilonDb: number;
}

export interface MidiConfig {
  devices: MidiDeviceConfig[];
  rescanIntervalMs: number;
  requireAllDevices: boolean;
}

export interface BridgeConfig {
  fairlight: FairlightConfig;
  midi: MidiConfig;
  mapping: MappingConfig;
  lcd: LcdConfig;
  safety: SafetyConfig;
  logLevel: LogLevel;
}

export interface RuntimeArming {
  writes: boolean;
  motors: boolean;
}

export const DEFAULT_CONFIG: BridgeConfig = {
  fairlight: {
    host: "127.0.0.1",
    port: 9000,
    requestTimeoutMs: 2000,
    reconnectAttempts: -1,
  },
  midi: {
    devices: [],
    rescanIntervalMs: 2000,
    requireAllDevices: false,
  },
  mapping: {
    bankStep: 24,
    singleChannel: null,
    singleChannelName: null,
    master: {
      enabled: false,
      busType: "main",
      busIndex: 1,
    },
    sendsOnFader: {
      enabled: false,
      busIndex: 1,
    },
    buttonAssignments: {},
    layout: null,
  },
  lcd: defaultLcdConfig(),
  safety: {
    requireTouchForWrites: true,
    alignMotorsOnStart: true,
    alignMotorsOnBankChange: true,
    allowedWriteChannels: [],
    allowedWriteBuses: [],
    allowedWriteMonitors: [],
    maxWritesPerSecond: 20,
    writeExpiryMs: 250,
    feedbackEpsilonDb: 0.05,
  },
  logLevel: "info",
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) throw new ConfigError(`${path} must be an object`, { path });
  return value;
}

function readString(value: unknown, path: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${path} must be a non-empty string`, { path });
  }
  return value;
}

function readNumber(
  value: unknown,
  path: string,
  fallback: number,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`${path} must be a finite number`, { path });
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new ConfigError(`${path} must be an integer`, { path });
  }
  if (options.min !== undefined && value < options.min) {
    throw new ConfigError(`${path} must be >= ${options.min}`, { path });
  }
  if (options.max !== undefined && value > options.max) {
    throw new ConfigError(`${path} must be <= ${options.max}`, { path });
  }
  return value;
}

function readDeviceName(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ConfigError(`${path} must be a string`, { path });
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 40) {
    throw new ConfigError(`${path} must be at most 40 characters`, { path });
  }
  return trimmed;
}

function readBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ConfigError(`${path} must be a boolean`, { path });
  return value;
}

function readNumberArray(value: unknown, path: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be an array`, { path });
  const numbers: number[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 1) {
      throw new ConfigError(`${path}[${index}] must be a positive integer`, { path });
    }
    numbers.push(entry);
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function readStringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be an array`, { path });
  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ConfigError(`${path}[${index}] must be a non-empty string`, { path });
    }
    strings.push(entry);
  }
  return [...new Set(strings)];
}

function readResource(value: unknown, path: string): MidiPortSelector {
  if (value === undefined) {
    throw new ConfigError(`${path} is required`, { path });
  }
  if (typeof value === "string") {
    return { name: value, occurrence: 0 };
  }
  const object = objectAt(value, path);
  const name = readString(object["name"], `${path}.name`, "");
  if (name === "") {
    throw new ConfigError(`${path}.name is required`, { path });
  }
  return {
    name,
    occurrence: readNumber(object["occurrence"], `${path}.occurrence`, 0, {
      min: 0,
      integer: true,
    }),
  };
}

function readDevice(value: unknown, path: string): MidiDeviceConfig {
  const object = objectAt(value, path);
  const role = readString(object["role"], `${path}.role`, "");
  if (!isSurfaceRoleId(role)) {
    throw new ConfigError(`${path}.role must be a lowercase identifier (a-z, 0-9, -, _)`, { path });
  }
  const kindValue = readString(object["kind"], `${path}.kind`, role === "main" ? "main" : "extender");
  if (!(SURFACE_KINDS as readonly string[]).includes(kindValue)) {
    throw new ConfigError(`${path}.kind must be one of ${SURFACE_KINDS.join(", ")}`, { path });
  }
  const transportValue = readString(object["transport"], `${path}.transport`, "usb");
  if (!(MIDI_TRANSPORTS as readonly string[]).includes(transportValue)) {
    throw new ConfigError(`${path}.transport must be one of ${MIDI_TRANSPORTS.join(", ")}`, { path });
  }
  const transport = transportValue as MidiTransport;
  const encoderValue = readString(object["encoder"], `${path}.encoder`, "off");
  if (!(ENCODER_MODES as readonly string[]).includes(encoderValue)) {
    throw new ConfigError(`${path}.encoder must be one of ${ENCODER_MODES.join(", ")}`, { path });
  }
  return {
    role,
    kind: kindValue as SurfaceKind,
    name: readDeviceName(object["name"], `${path}.name`),
    enabled: readBoolean(object["enabled"], `${path}.enabled`, true),
    transport,
    input: readResource(object["input"], `${path}.input`),
    output: readResource(object["output"], `${path}.output`),
    network: transport === "network" ? readNetwork(object["network"], `${path}.network`) : null,
    encoder: encoderValue as EncoderMode,
    meters: readBoolean(object["meters"], `${path}.meters`, false),
  };
}

function readNetwork(value: unknown, path: string): MidiNetworkConfig {
  const object = objectAt(value, path);
  const host = readString(object["host"], `${path}.host`, "");
  if (host === "") {
    throw new ConfigError(`${path}.host is required for network transport`, { path });
  }
  if (!isValidNetworkHost(host)) {
    throw new ConfigError(`${path}.host must be an IPv4 address or host name`, { path });
  }
  return {
    host,
    port: readNumber(object["port"], `${path}.port`, DEFAULT_NETWORK_PORT, {
      min: 1,
      max: 65535,
      integer: true,
    }),
  };
}

export function isValidNetworkHost(host: string): boolean {
  return host.length <= 253 && /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host);
}

function validatePortUniqueness(devices: MidiDeviceConfig[], key: "input" | "output"): void {
  const seen = new Map<string, SurfaceRole>();
  for (const device of devices) {
    if (!device.enabled || device.transport !== "usb") continue;
    const selector = device[key];
    const identity = `${selector.name}\u0000${selector.occurrence}`;
    const existing = seen.get(identity);
    if (existing) {
      throw new ConfigError(
        `MIDI ${key} "${selector.name}" (occurrence ${selector.occurrence}) is assigned to both ${existing} and ${device.role}`,
        { role: device.role, selector },
      );
    }
    seen.set(identity, device.role);
  }
}

function validateNetworkUniqueness(devices: MidiDeviceConfig[]): void {
  const seen = new Map<string, SurfaceRole>();
  for (const device of devices) {
    if (!device.enabled || device.transport !== "network" || device.network === null) continue;
    const identity = `${device.network.host}\u0000${device.network.port}`;
    const existing = seen.get(identity);
    if (existing) {
      throw new ConfigError(
        `Network endpoint "${device.network.host}:${device.network.port}" is assigned to both ${existing} and ${device.role}`,
        { role: device.role, network: device.network },
      );
    }
    seen.set(identity, device.role);
  }
}

function readButtonAssignments(value: unknown): Partial<Record<ButtonId, ButtonAssignmentConfig>> {
  const path = "mapping.buttonAssignments";
  if (value === undefined || value === null) return {};
  const object = objectAt(value, path);
  const assignments: Partial<Record<ButtonId, ButtonAssignmentConfig>> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (!isButtonId(key)) {
      throw new ConfigError(`${path}.${key} is not a configurable button (${BUTTON_IDS.join(", ")})`, {
        path: `${path}.${key}`,
      });
    }
    const buttonPath = `${path}.${key}`;
    const assignment = objectAt(entry, buttonPath);
    const type = assignment["type"];
    if (type === "monitor-dim") {
      assignments[key] = {
        type,
        monitorIndex: readNumber(assignment["monitorIndex"], `${buttonPath}.monitorIndex`, 1, {
          min: 1,
          max: 4,
          integer: true,
        }),
      };
      continue;
    }
    if (type !== "sends-on-fader") {
      throw new ConfigError(`${buttonPath}.type must be sends-on-fader or monitor-dim`, {
        path: `${buttonPath}.type`,
      });
    }
    assignments[key] = {
      type,
      auxIndex: readNumber(assignment["auxIndex"], `${buttonPath}.auxIndex`, 1, {
        min: 1,
        integer: true,
      }),
    };
  }
  return assignments;
}

export function configuredAuxTargets(config: MappingConfig): number[] {
  const targets = new Set<number>();
  if (config.sendsOnFader.enabled) targets.add(config.sendsOnFader.busIndex);
  for (const assignment of Object.values(config.buttonAssignments)) {
    if (assignment?.type === "sends-on-fader") targets.add(assignment.auxIndex);
  }
  return [...targets].sort((a, b) => a - b);
}

export function configuredMonitorTargets(config: MappingConfig): number[] {
  const targets = new Set<number>();
  for (const assignment of Object.values(config.buttonAssignments)) {
    if (assignment?.type === "monitor-dim") targets.add(assignment.monitorIndex);
  }
  return [...targets].sort((a, b) => a - b);
}

function readFixedTarget(
  value: unknown,
  path: string,
  channels: Set<number>,
  buses: Set<string>,
): FixedTargetConfig | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1) {
      throw new ConfigError(`${path} must be a positive channel number or null`, { path });
    }
    if (channels.has(value)) {
      throw new ConfigError(`mapping.layout assigns channel ${value} more than once`, { path });
    }
    channels.add(value);
    return { kind: "channel", channel: value };
  }
  if (!isObject(value)) {
    throw new ConfigError(`${path} must be a channel number, a target object or null`, { path });
  }
  const kind = value["kind"];
  if (kind === "channel") {
    const channel = value["channel"];
    if (typeof channel !== "number" || !Number.isInteger(channel) || channel < 1) {
      throw new ConfigError(`${path}.channel must be a positive integer`, { path });
    }
    if (channels.has(channel)) {
      throw new ConfigError(`mapping.layout assigns channel ${channel} more than once`, { path });
    }
    channels.add(channel);
    return { kind: "channel", channel };
  }
  if (kind === "bus") {
    const busType = value["busType"];
    const index = value["index"];
    if (typeof busType !== "string" || !(BUS_TYPES as readonly string[]).includes(busType)) {
      throw new ConfigError(`${path}.busType must be one of ${BUS_TYPES.join(", ")}`, { path });
    }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 1) {
      throw new ConfigError(`${path}.index must be a positive integer`, { path });
    }
    const identity = `${busType}:${index}`;
    if (buses.has(identity)) {
      throw new ConfigError(`mapping.layout assigns bus ${identity} more than once`, { path });
    }
    buses.add(identity);
    return { kind: "bus", busType: busType as BusType, index };
  }
  throw new ConfigError(`${path}.kind must be channel or bus`, { path });
}

function readLayout(value: unknown): LayoutConfig | null {
  if (value === undefined || value === null) return null;
  const layoutObject = objectAt(value, "mapping.layout");
  const rawOrder = layoutObject["order"];
  if (!Array.isArray(rawOrder)) {
    throw new ConfigError("mapping.layout.order must be an array", { path: "mapping.layout.order" });
  }
  if (rawOrder.length === 0) {
    throw new ConfigError("mapping.layout.order must list at least one surface", {
      path: "mapping.layout.order",
    });
  }
  const order: SurfaceRole[] = [];
  for (const [index, entry] of rawOrder.entries()) {
    if (typeof entry !== "string" || !isSurfaceRoleId(entry)) {
      throw new ConfigError(
        `mapping.layout.order[${index}] must be a lowercase surface identifier`,
        { path: "mapping.layout.order" },
      );
    }
    if (order.includes(entry)) {
      throw new ConfigError(`mapping.layout.order contains ${entry} more than once`, {
        path: "mapping.layout.order",
      });
    }
    order.push(entry);
  }

  const surfacesObject = objectAt(layoutObject["surfaces"], "mapping.layout.surfaces");
  const surfaces = {} as Record<SurfaceRole, SurfaceAssignmentConfig>;
  const fixedChannels = new Set<number>();
  const fixedBuses = new Set<string>();
  for (const role of order) {
    const path = `mapping.layout.surfaces.${role}`;
    const surfaceObject = objectAt(surfacesObject[role], path);
    const modeValue = surfaceObject["mode"] ?? "banking";
    if (typeof modeValue !== "string" || !(SURFACE_MODES as readonly string[]).includes(modeValue)) {
      throw new ConfigError(`${path}.mode must be one of ${SURFACE_MODES.join(", ")}`, { path });
    }
    let fixedTargets: Array<FixedTargetConfig | null> = [];
    if (modeValue === "fixed") {
      const rawTargets = surfaceObject["fixedTargets"];
      const rawChannels = surfaceObject["fixedChannels"];
      if (rawTargets !== undefined && rawChannels !== undefined) {
        throw new ConfigError(`${path} must use either fixedTargets or fixedChannels, not both`, { path });
      }
      const rawEntries = rawTargets ?? rawChannels;
      if (rawEntries !== undefined && !Array.isArray(rawEntries)) {
        throw new ConfigError(`${path}.fixedTargets must be an array`, { path });
      }
      const entries = rawEntries ?? [];
      if (entries.length > 8) {
        throw new ConfigError(`${path}.fixedTargets supports at most 8 entries`, { path });
      }
      for (const [index, entry] of entries.entries()) {
        fixedTargets.push(readFixedTarget(entry, `${path}.fixedTargets[${index}]`, fixedChannels, fixedBuses));
      }
      while (fixedTargets.length < 8) fixedTargets.push(null);
    }
    surfaces[role] = { mode: modeValue as SurfaceMode, fixedTargets };
  }
  return { order, surfaces };
}

function readLcdTarget(value: unknown, path: string): FixedTargetConfig {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1) {
      throw new ConfigError(`${path} must be a positive channel number`, { path });
    }
    return { kind: "channel", channel: value };
  }
  if (!isObject(value)) {
    throw new ConfigError(`${path} must be a target object`, { path });
  }
  const kind = value["kind"];
  if (kind === "channel") {
    const channel = value["channel"];
    if (typeof channel !== "number" || !Number.isInteger(channel) || channel < 1) {
      throw new ConfigError(`${path}.channel must be a positive integer`, { path });
    }
    return { kind: "channel", channel };
  }
  if (kind === "bus") {
    const busType = value["busType"];
    const index = value["index"];
    if (typeof busType !== "string" || !(BUS_TYPES as readonly string[]).includes(busType)) {
      throw new ConfigError(`${path}.busType must be one of ${BUS_TYPES.join(", ")}`, { path });
    }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 1) {
      throw new ConfigError(`${path}.index must be a positive integer`, { path });
    }
    return { kind: "bus", busType: busType as BusType, index };
  }
  throw new ConfigError(`${path}.kind must be channel or bus`, { path });
}

function readLcdShortName(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ConfigError(`${path} must be a string`, { path });
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (Array.from(trimmed).length > 7) {
    throw new ConfigError(`${path} must be at most 7 characters`, { path });
  }
  return trimmed;
}

function readLcdExpectedName(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ConfigError(`${path} must be a string`, { path });
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readLcdColor(value: unknown, path: string, fallback: LcdColor): LcdColor {
  if (value === undefined) return fallback;
  if (!isLcdColor(value)) {
    throw new ConfigError(`${path} must be one of ${["off", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].join(", ")}`, {
      path,
    });
  }
  return value;
}

function readLcdLineMode(value: unknown, path: string, fallback: LcdLineMode): LcdLineMode {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(LCD_LINE_MODES as readonly string[]).includes(value)) {
    throw new ConfigError(`${path} must be one of ${LCD_LINE_MODES.join(", ")}`, { path });
  }
  return value as LcdLineMode;
}

function readLcd(value: unknown): LcdConfig {
  const object = objectAt(value, "lcd");
  const defaults = defaultLcdConfig();
  const paletteObject = objectAt(object["palette"], "lcd.palette");
  const palette = {} as LcdPaletteConfig;
  for (const key of LCD_PALETTE_KEYS) {
    palette[key] = readLcdColor(paletteObject[key], `lcd.palette.${key}`, defaults.palette[key]);
  }
  const rawOverrides = object["overrides"];
  if (rawOverrides !== undefined && !Array.isArray(rawOverrides)) {
    throw new ConfigError("lcd.overrides must be an array", { path: "lcd.overrides" });
  }
  const overrides: LcdOverrideConfig[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of (rawOverrides ?? []).entries()) {
    const path = `lcd.overrides[${index}]`;
    const overrideObject = objectAt(entry, path);
    const target = readLcdTarget(overrideObject["target"], `${path}.target`);
    const key = fixedTargetKey(target);
    if (seen.has(key)) {
      throw new ConfigError(`lcd.overrides assigns ${key} more than once`, { path });
    }
    seen.add(key);
    const colorValue = overrideObject["color"] ?? "auto";
    if (colorValue !== "auto" && !isLcdColor(colorValue)) {
      throw new ConfigError(`${path}.color must be auto or a known LCD colour`, { path });
    }
    overrides.push({
      target,
      color: colorValue as LcdColor | "auto",
      name: readLcdShortName(overrideObject["name"], `${path}.name`),
      expectedName: readLcdExpectedName(overrideObject["expectedName"], `${path}.expectedName`),
    });
  }
  return {
    colorsEnabled: readBoolean(object["colorsEnabled"], "lcd.colorsEnabled", defaults.colorsEnabled),
    line1: readLcdLineMode(object["line1"], "lcd.line1", defaults.line1),
    line2: readLcdLineMode(object["line2"], "lcd.line2", defaults.line2),
    palette,
    overrides,
  };
}

export function parseConfig(value: unknown): BridgeConfig {
  const root = objectAt(value, "config");
  const fairlightObject = objectAt(root["fairlight"], "fairlight");
  const midiObject = objectAt(root["midi"], "midi");
  const mappingObject = objectAt(root["mapping"], "mapping");
  const masterObject = objectAt(mappingObject["master"], "mapping.master");
  const safetyObject = objectAt(root["safety"], "safety");

  const rawDevices = midiObject["devices"];
  if (rawDevices !== undefined && !Array.isArray(rawDevices)) {
    throw new ConfigError("midi.devices must be an array", { path: "midi.devices" });
  }
  const devices = (rawDevices ?? []).map((entry, index) => readDevice(entry, `midi.devices[${index}]`));
  const roles = new Set<SurfaceRole>();
  for (const device of devices) {
    if (roles.has(device.role)) {
      throw new ConfigError(`midi.devices contains role ${device.role} more than once`, { role: device.role });
    }
    roles.add(device.role);
  }
  const mains = devices.filter((device) => device.kind === "main");
  if (mains.length > 1) {
    throw new ConfigError(
      `midi.devices may define at most one main surface (found ${mains.map((device) => device.role).join(", ")})`,
      { roles: mains.map((device) => device.role) },
    );
  }
  validatePortUniqueness(devices, "input");
  validatePortUniqueness(devices, "output");
  validateNetworkUniqueness(devices);

  const logLevelValue = root["logLevel"];
  if (logLevelValue !== undefined && (typeof logLevelValue !== "string" || !isLogLevel(logLevelValue))) {
    throw new ConfigError("logLevel must be one of debug, info, warn, error", { path: "logLevel" });
  }

  const bankStep = readNumber(mappingObject["bankStep"], "mapping.bankStep", DEFAULT_CONFIG.mapping.bankStep, {
    min: 1,
    integer: true,
  });
  const singleChannelValue = mappingObject["singleChannel"];
  const singleChannel =
    singleChannelValue === undefined || singleChannelValue === null
      ? null
      : readNumber(singleChannelValue, "mapping.singleChannel", 1, { min: 1, integer: true });
  const singleChannelNameValue = mappingObject["singleChannelName"];
  const singleChannelName =
    singleChannelNameValue === undefined || singleChannelNameValue === null
      ? null
      : readString(singleChannelNameValue, "mapping.singleChannelName", "");
  if (singleChannelName !== null && singleChannel === null) {
    throw new ConfigError("mapping.singleChannelName requires mapping.singleChannel", {
      path: "mapping.singleChannelName",
    });
  }
  const busTypeValue = readString(masterObject["busType"], "mapping.master.busType", DEFAULT_CONFIG.mapping.master.busType);
  if (!(BUS_TYPES as readonly string[]).includes(busTypeValue)) {
    throw new ConfigError(`mapping.master.busType must be one of ${BUS_TYPES.join(", ")}`, {
      path: "mapping.master.busType",
    });
  }
  const layout = readLayout(mappingObject["layout"]);
  const sendsOnFaderObject = objectAt(mappingObject["sendsOnFader"], "mapping.sendsOnFader");
  const buttonAssignments = readButtonAssignments(mappingObject["buttonAssignments"]);

  const maxWritesPerSecond = readNumber(
    safetyObject["maxWritesPerSecond"],
    "safety.maxWritesPerSecond",
    DEFAULT_CONFIG.safety.maxWritesPerSecond,
    { min: 1, max: 100, integer: true },
  );
  const writeExpiryMs = readNumber(
    safetyObject["writeExpiryMs"],
    "safety.writeExpiryMs",
    DEFAULT_CONFIG.safety.writeExpiryMs,
    { min: 50, max: 5000, integer: true },
  );

  const config: BridgeConfig = {
    fairlight: {
      host: readString(fairlightObject["host"], "fairlight.host", DEFAULT_CONFIG.fairlight.host),
      port: readNumber(fairlightObject["port"], "fairlight.port", DEFAULT_CONFIG.fairlight.port, {
        min: 1,
        max: 65535,
        integer: true,
      }),
      requestTimeoutMs: readNumber(
        fairlightObject["requestTimeoutMs"],
        "fairlight.requestTimeoutMs",
        DEFAULT_CONFIG.fairlight.requestTimeoutMs,
        { min: 250, max: 60000, integer: true },
      ),
      reconnectAttempts: readNumber(
        fairlightObject["reconnectAttempts"],
        "fairlight.reconnectAttempts",
        DEFAULT_CONFIG.fairlight.reconnectAttempts,
        { min: -1, integer: true },
      ),
    },
    midi: {
      devices,
      rescanIntervalMs: readNumber(
        midiObject["rescanIntervalMs"],
        "midi.rescanIntervalMs",
        DEFAULT_CONFIG.midi.rescanIntervalMs,
        { min: 250, max: 60000, integer: true },
      ),
      requireAllDevices: readBoolean(
        midiObject["requireAllDevices"],
        "midi.requireAllDevices",
        DEFAULT_CONFIG.midi.requireAllDevices,
      ),
    },
    mapping: {
      bankStep,
      singleChannel,
      singleChannelName,
      master: {
        enabled: readBoolean(masterObject["enabled"], "mapping.master.enabled", DEFAULT_CONFIG.mapping.master.enabled),
        busType: busTypeValue as BusType,
        busIndex: readNumber(masterObject["busIndex"], "mapping.master.busIndex", DEFAULT_CONFIG.mapping.master.busIndex, {
          min: 1,
          integer: true,
        }),
      },
      layout,
      sendsOnFader: {
        enabled: readBoolean(
          sendsOnFaderObject["enabled"],
          "mapping.sendsOnFader.enabled",
          DEFAULT_CONFIG.mapping.sendsOnFader.enabled,
        ),
        busIndex: readNumber(
          sendsOnFaderObject["busIndex"],
          "mapping.sendsOnFader.busIndex",
          DEFAULT_CONFIG.mapping.sendsOnFader.busIndex,
          { min: 1, integer: true },
        ),
      },
      buttonAssignments,
    },
    lcd: readLcd(root["lcd"]),
    safety: {
      requireTouchForWrites: readBoolean(
        safetyObject["requireTouchForWrites"],
        "safety.requireTouchForWrites",
        DEFAULT_CONFIG.safety.requireTouchForWrites,
      ),
      alignMotorsOnStart: readBoolean(
        safetyObject["alignMotorsOnStart"],
        "safety.alignMotorsOnStart",
        DEFAULT_CONFIG.safety.alignMotorsOnStart,
      ),
      alignMotorsOnBankChange: readBoolean(
        safetyObject["alignMotorsOnBankChange"],
        "safety.alignMotorsOnBankChange",
        DEFAULT_CONFIG.safety.alignMotorsOnBankChange,
      ),
      allowedWriteChannels: readNumberArray(
        safetyObject["allowedWriteChannels"],
        "safety.allowedWriteChannels",
      ),
      allowedWriteBuses: readStringArray(safetyObject["allowedWriteBuses"], "safety.allowedWriteBuses"),
      allowedWriteMonitors: readNumberArray(safetyObject["allowedWriteMonitors"], "safety.allowedWriteMonitors"),
      maxWritesPerSecond,
      writeExpiryMs,
      feedbackEpsilonDb: readNumber(
        safetyObject["feedbackEpsilonDb"],
        "safety.feedbackEpsilonDb",
        DEFAULT_CONFIG.safety.feedbackEpsilonDb,
        { min: 0.001, max: 2 },
      ),
    },
    logLevel: (logLevelValue as LogLevel | undefined) ?? DEFAULT_CONFIG.logLevel,
  };

  return config;
}

export interface LoadConfigOptions {
  allowMissing?: boolean;
}

export function loadConfig(path: string, options: LoadConfigOptions = {}): BridgeConfig {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    if (options.allowMissing) return structuredClone(DEFAULT_CONFIG);
    throw new ConfigError(`Configuration file not found: ${absolute}`, { path: absolute });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new ConfigError(`Cannot read configuration file ${absolute}`, {
      path: absolute,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return parseConfig(parsed);
}
