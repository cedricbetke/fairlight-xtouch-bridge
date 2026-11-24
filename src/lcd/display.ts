import type { BusType, FixedTargetConfig, LcdConfig, LcdLineMode, LcdOverrideConfig } from "../config.js";
import type { LcdColor } from "./colors.js";

export const BUS_TYPE_LABELS: Record<BusType, string> = {
  main: "MAIN",
  sub: "SUB",
  aux: "AUX",
  mixm: "MIXM",
  mtx: "MTX",
  vca: "VCA",
};

export type LcdDisplayTarget =
  | { kind: "channel"; index: number; name: string }
  | { kind: "bus"; busType: BusType; index: number; name: string };

export interface LcdDisplay {
  top: string;
  bottom: string;
  color: LcdColor;
  colorEnabled: boolean;
  overrideActive: boolean;
  overrideMismatch: boolean;
}

export interface LcdDisplayContext {
  /** Confirmed Fairlight level for this strip, in dB. */
  levelDb?: number | null;
  /** Overrides the derived target label, e.g. `AUX 2` in sends-on-fader mode. */
  targetLabel?: string | null;
  /** True when the mapped target has no usable value, e.g. a missing aux send. */
  unavailable?: boolean;
  /** Text for the value/target lines while unavailable. Defaults to `NO SEND`. */
  unavailableText?: string;
}

const LCD_WIDTH = 7;
const LCD_UNAVAILABLE = "NO SEND";

export function formatLcdLevel(db: number | null | undefined): string {
  if (db === null || db === undefined || !Number.isFinite(db)) return "--";
  const clamped = Math.min(10, Math.max(-100, db));
  if (clamped <= -100) return "-100dB";
  return `${clamped.toFixed(1)}dB`;
}

export function lcdTargetLabel(target: LcdDisplayTarget): string {
  return target.kind === "channel" ? `CH ${target.index}` : `${BUS_TYPE_LABELS[target.busType]} ${target.index}`;
}

export function clampLcdText(text: string): string {
  const characters = Array.from(text).slice(0, LCD_WIDTH).map((character) => {
    const code = character.codePointAt(0) ?? 0x20;
    return code >= 0x20 && code <= 0x7e ? character : " ";
  });
  while (characters.length < LCD_WIDTH) characters.push(" ");
  return characters.join("");
}

export function lcdTargetKey(target: FixedTargetConfig): string {
  return target.kind === "channel" ? `channel:${target.channel}` : `bus:${target.busType}:${target.index}`;
}

export function displayTargetKey(target: LcdDisplayTarget): string {
  return target.kind === "channel" ? `channel:${target.index}` : `bus:${target.busType}:${target.index}`;
}

export function overrideMatchesTarget(override: LcdOverrideConfig, target: LcdDisplayTarget): boolean {
  if (lcdTargetKey(override.target) !== displayTargetKey(target)) return false;
  if (override.expectedName === null) return true;
  return override.expectedName.trim() === target.name.trim();
}

export function findOverride(config: LcdConfig, target: LcdDisplayTarget): LcdOverrideConfig | undefined {
  return config.overrides.find((override) => overrideMatchesTarget(override, target));
}

export function overrideIsPaused(config: LcdConfig, target: LcdDisplayTarget): boolean {
  return config.overrides.some(
    (override) =>
      lcdTargetKey(override.target) === displayTargetKey(target) && !overrideMatchesTarget(override, target),
  );
}

function resolveLine(
  mode: LcdLineMode,
  target: LcdDisplayTarget,
  name: string,
  override: LcdOverrideConfig | undefined,
  context: LcdDisplayContext,
): string {
  if (mode === "blank") return "";
  if (mode === "name") return name;
  if (mode === "custom") return override?.name ?? name;
  if (mode === "value") {
    if (context.unavailable) return context.unavailableText ?? LCD_UNAVAILABLE;
    return context.levelDb === undefined ? "--" : formatLcdLevel(context.levelDb);
  }
  if (mode === "target") {
    if (context.unavailable) return context.unavailableText ?? LCD_UNAVAILABLE;
    return context.targetLabel ?? lcdTargetLabel(target);
  }
  const typeLabel = target.kind === "channel" ? "CH" : BUS_TYPE_LABELS[target.busType];
  const numberLabel = String(target.index);
  if (mode === "type-number") return `${typeLabel} ${numberLabel}`;
  if (mode === "type") return typeLabel;
  return numberLabel;
}

function resolveColor(
  config: LcdConfig,
  target: LcdDisplayTarget,
  override: LcdOverrideConfig | undefined,
): LcdColor {
  if (override && override.color !== "auto") return override.color;
  return config.palette[target.kind === "channel" ? "channel" : target.busType];
}

export function resolveLcdDisplay(
  config: LcdConfig,
  target: LcdDisplayTarget | null,
  context: LcdDisplayContext = {},
): LcdDisplay {
  if (target === null) {
    return {
      top: clampLcdText(""),
      bottom: clampLcdText(""),
      color: "off",
      colorEnabled: config.colorsEnabled,
      overrideActive: false,
      overrideMismatch: false,
    };
  }
  const override = findOverride(config, target);
  const paused = overrideIsPaused(config, target);
  return {
    top: clampLcdText(resolveLine(config.line1, target, target.name, override, context)),
    bottom: clampLcdText(resolveLine(config.line2, target, target.name, override, context)),
    color: config.colorsEnabled ? resolveColor(config, target, override) : "off",
    colorEnabled: config.colorsEnabled,
    overrideActive: override !== undefined,
    overrideMismatch: paused,
  };
}
