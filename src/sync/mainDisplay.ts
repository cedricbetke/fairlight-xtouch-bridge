import type { MainDisplayConfig, MainDisplayMeasurement } from "../config.js";
import {
  blankSegmentCells,
  MCU_SEGMENT_DIGITS,
  segmentCellsFromText,
  type SegmentCell,
} from "../mcu/segmentDisplay.js";

export interface MainDisplayMeterReading {
  measurement: MainDisplayMeasurement;
  /** Loudness in LUFS, or peak level in dB for the headroom reserve. */
  value: number | null;
}

export interface MainDisplayInput {
  config: MainDisplayConfig;
  /** Fairlight is connected and its snapshot has been applied. */
  connected: boolean;
  /** Active aux in sends-on-fader mode, `null` in the main mix. */
  sendAux: number | null;
  /** Channels shown on the selected surfaces, in strip order. */
  visibleChannels: readonly number[];
  /** Fairlight's on-air state, `null` when unknown. */
  onAir: boolean | null;
  /** Reading for the `meter` mode, `null` when no source is selected. */
  meter: MainDisplayMeterReading | null;
  now: Date;
}

/**
 * Builds the ten-digit frame for the main X-Touch display, or `null` when the
 * display has to be cleared.
 *
 * Only formats whose characters are backed by the protocol references and
 * other MCU implementations are used: digits, `A`-`Z`, `-` and the per-digit
 * decimal point. Words and signs remain visually unverified on the device, so
 * `on-air` is an explicit experimental option.
 */
export function mainDisplayCells(input: MainDisplayInput): SegmentCell[] | null {
  const { mode } = input.config;
  if (mode === "off") return null;
  if (mode === "clock") return clockCells(input.now);
  if (!input.connected) return null;
  if (mode === "meter") return meterCells(input.meter);
  if (mode === "on-air") {
    if (input.onAir === null) return null;
    return segmentCellsFromText(input.onAir ? "ON AIR" : "OFF AIR");
  }
  if (mode === "auto" && input.sendAux !== null) {
    return segmentCellsFromText(String(input.sendAux).padStart(2, "0"));
  }
  return channelCells(input.visibleChannels);
}

/**
 * Integrated loudness keeps its sign because the value itself is negative in
 * normal operation; the headroom reserve is deliberately positive so it never
 * depends on the unverified minus glyph.
 */
function meterCells(meter: MainDisplayMeterReading | null): SegmentCell[] | null {
  if (!meter || meter.value === null || !Number.isFinite(meter.value)) return null;
  if (meter.measurement === "headroom") {
    const reserve = Math.min(99.9, Math.max(0, -meter.value));
    return segmentCellsFromText(reserve.toFixed(1));
  }
  return segmentCellsFromText(meter.value.toFixed(1));
}

/**
 * Picks the rightmost visible channel or, for a gap-free run, the range.
 * The range avoids `-` because the hyphen's visibility on the X-Touch is not
 * verified; two digit blocks are unambiguous.
 */
function channelCells(visibleChannels: readonly number[]): SegmentCell[] | null {
  if (visibleChannels.length === 0) return null;
  const first = visibleChannels[0] ?? 0;
  const last = visibleChannels[visibleChannels.length - 1] ?? first;
  const contiguous = visibleChannels.every((channel, index) => index === 0 || channel === (visibleChannels[index - 1] ?? channel) + 1);
  if (contiguous && visibleChannels.length > 1) return segmentCellsFromText(`${first}  ${last}`);
  return segmentCellsFromText(String(first));
}

/**
 * Places hours, minutes and seconds in the physical 3-2-2-3 digit groups:
 * hours right-aligned in the first group, minutes and seconds in the middle
 * groups, dots after the last minute and second digit. The frames group stays
 * empty. This follows the grouping used by the Ableton X-Touch script.
 */
function clockCells(now: Date): SegmentCell[] {
  const cells = blankSegmentCells(MCU_SEGMENT_DIGITS);
  const place = (start: number, text: string): void => {
    const digits = Array.from(text);
    for (let index = 0; index < digits.length; index += 1) {
      const cell = cells[start + index];
      if (cell) cell.character = digits[index] ?? " ";
    }
  };
  place(1, pad2(now.getHours()));
  place(3, pad2(now.getMinutes()));
  place(5, pad2(now.getSeconds()));
  const minutesDot = cells[4];
  const secondsDot = cells[6];
  if (minutesDot) minutesDot.dot = true;
  if (secondsDot) secondsDot.dot = true;
  return cells;
}

function pad2(value: number): string {
  return String(Math.abs(Math.trunc(value)) % 100).padStart(2, "0");
}
