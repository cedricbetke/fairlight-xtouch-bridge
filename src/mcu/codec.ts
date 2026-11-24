import { LCD_COLOR_CODES, type LcdColor } from "../lcd/colors.js";
import { buttonForNote, type ButtonId } from "./buttons.js";

export const MCU_STRIPS = 8;
export const MCU_MASTER_STRIP = 8;

export const MCU_STATUS_NOTE_ON = 0x90;
export const MCU_STATUS_NOTE_OFF = 0x80;
export const MCU_STATUS_CONTROL_CHANGE = 0xb0;
export const MCU_STATUS_PITCH_BEND = 0xe0;
export const MCU_STATUS_CHANNEL_PRESSURE = 0xd0;

export const MCU_NOTE_RECORD_BASE = 0x00;
export const MCU_NOTE_SOLO_BASE = 0x08;
export const MCU_NOTE_MUTE_BASE = 0x10;
export const MCU_NOTE_SELECT_BASE = 0x18;
export const MCU_NOTE_ENCODER_PUSH_BASE = 0x20;
export const MCU_NOTE_TOUCH_BASE = 0x68;
export const MCU_NOTE_MASTER_TOUCH = 0x70;
export const MCU_NOTE_FLIP = 0x32;
export const MCU_NOTE_SEND = 0x29;
export const MCU_NOTE_PAN = 0x2a;
export const MCU_NOTE_F1 = 0x36;
export const MCU_NOTE_BANK_LEFT = 0x2e;
export const MCU_NOTE_BANK_RIGHT = 0x2f;
export const MCU_NOTE_CHANNEL_LEFT = 0x30;
export const MCU_NOTE_CHANNEL_RIGHT = 0x31;

export const MCU_CC_ENCODER_BASE = 0x10;
export const MCU_CC_VPOT_RING_BASE = 0x30;
export const MCU_CC_JOG = 0x3c;

export const MCU_SYSEX_HEADER = [0xf0, 0x00, 0x00, 0x66] as const;
export const MCU_LCD_DEVICE_XTOUCH = 0x14;
export const MCU_LCD_DEVICE_EXTENDER = 0x15;

export type McuButtonName =
  | "record"
  | "solo"
  | "mute"
  | "select"
  | "encoder-push"
  | "flip";

export type McuEvent =
  | { type: "fader"; strip: number; raw: number }
  | { type: "touch"; strip: number; touched: boolean }
  | { type: "button"; button: McuButtonName; strip: number | null; pressed: boolean }
  | { type: "encoder"; strip: number; delta: number }
  | { type: "bank"; direction: "left" | "right" }
  | { type: "assign"; assign: "send" | "pan" }
  | { type: "function"; button: ButtonId }
  | { type: "channel-nav"; direction: "left" | "right" }
  | { type: "jog"; delta: number };

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decodeRelative(value: number): number {
  const magnitude = value & 0x3f;
  return (value & 0x40) !== 0 ? -magnitude : magnitude;
}

function noteOn(status: number): boolean {
  return (status & 0xf0) === MCU_STATUS_NOTE_ON;
}

function noteOff(status: number): boolean {
  return (status & 0xf0) === MCU_STATUS_NOTE_OFF;
}

export function decodeMcuMessage(message: readonly number[]): McuEvent | null {
  if (message.length < 3) return null;
  const status = message[0] ?? 0;
  const data1 = message[1] ?? 0;
  const data2 = message[2] ?? 0;

  if (status >= MCU_STATUS_PITCH_BEND && status <= MCU_STATUS_PITCH_BEND + MCU_MASTER_STRIP) {
    const strip = status - MCU_STATUS_PITCH_BEND;
    const raw = (data1 & 0x7f) | ((data2 & 0x7f) << 7);
    return { type: "fader", strip, raw };
  }

  if ((status & 0x0f) !== 0) return null;

  if (noteOn(status) || noteOff(status)) {
    const pressed = noteOn(status) && data2 > 0;
    if (data1 >= MCU_NOTE_TOUCH_BASE && data1 <= MCU_NOTE_TOUCH_BASE + MCU_STRIPS - 1) {
      return { type: "touch", strip: data1 - MCU_NOTE_TOUCH_BASE, touched: pressed };
    }
    if (data1 === MCU_NOTE_MASTER_TOUCH) {
      return { type: "touch", strip: MCU_MASTER_STRIP, touched: pressed };
    }
    if (data1 >= MCU_NOTE_MUTE_BASE && data1 <= MCU_NOTE_MUTE_BASE + MCU_STRIPS - 1) {
      return { type: "button", button: "mute", strip: data1 - MCU_NOTE_MUTE_BASE, pressed };
    }
    if (data1 >= MCU_NOTE_SELECT_BASE && data1 <= MCU_NOTE_SELECT_BASE + MCU_STRIPS - 1) {
      return { type: "button", button: "select", strip: data1 - MCU_NOTE_SELECT_BASE, pressed };
    }
    if (data1 >= MCU_NOTE_SOLO_BASE && data1 <= MCU_NOTE_SOLO_BASE + MCU_STRIPS - 1) {
      return { type: "button", button: "solo", strip: data1 - MCU_NOTE_SOLO_BASE, pressed };
    }
    if (data1 >= MCU_NOTE_RECORD_BASE && data1 <= MCU_NOTE_RECORD_BASE + MCU_STRIPS - 1) {
      return { type: "button", button: "record", strip: data1 - MCU_NOTE_RECORD_BASE, pressed };
    }
    if (data1 >= MCU_NOTE_ENCODER_PUSH_BASE && data1 <= MCU_NOTE_ENCODER_PUSH_BASE + MCU_STRIPS - 1) {
      return { type: "button", button: "encoder-push", strip: data1 - MCU_NOTE_ENCODER_PUSH_BASE, pressed };
    }
    if (data1 === MCU_NOTE_FLIP) {
      return { type: "button", button: "flip", strip: null, pressed };
    }
    if (data1 === MCU_NOTE_BANK_LEFT) {
      return pressed ? { type: "bank", direction: "left" } : null;
    }
    if (data1 === MCU_NOTE_SEND) {
      return pressed ? { type: "assign", assign: "send" } : null;
    }
    if (data1 === MCU_NOTE_PAN) {
      return pressed ? { type: "assign", assign: "pan" } : null;
    }
    if (data1 >= MCU_NOTE_F1 && data1 < MCU_NOTE_F1 + 8) {
      if (!pressed) return null;
      const buttons = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"] as const;
      return { type: "function", button: buttons[data1 - MCU_NOTE_F1]! };
    }
    if (data1 === MCU_NOTE_BANK_RIGHT) {
      return pressed ? { type: "bank", direction: "right" } : null;
    }
    if (data1 === MCU_NOTE_CHANNEL_LEFT) {
      return pressed ? { type: "channel-nav", direction: "left" } : null;
    }
    if (data1 === MCU_NOTE_CHANNEL_RIGHT) {
      return pressed ? { type: "channel-nav", direction: "right" } : null;
    }
    if (pressed) {
      const button = buttonForNote(data1);
      if (button !== null) return { type: "function", button };
    }
    return null;
  }

  if ((status & 0xf0) === MCU_STATUS_CONTROL_CHANGE) {
    const channel = status & 0x0f;
    if (channel !== 0) return null;
    if (data1 >= MCU_CC_ENCODER_BASE && data1 <= MCU_CC_ENCODER_BASE + MCU_STRIPS - 1) {
      return { type: "encoder", strip: data1 - MCU_CC_ENCODER_BASE, delta: decodeRelative(data2) };
    }
    if (data1 === MCU_CC_JOG) {
      return { type: "jog", delta: decodeRelative(data2) };
    }
  }

  return null;
}

export function encodeFader(strip: number, raw: number): number[] {
  const clamped = clampNumber(Math.round(raw), 0, 16383);
  return [MCU_STATUS_PITCH_BEND + strip, clamped & 0x7f, (clamped >> 7) & 0x7f];
}

export function encodeLed(note: number, on: boolean): number[] {
  return [MCU_STATUS_NOTE_ON, note & 0x7f, on ? 0x7f : 0x00];
}

export function encodeMuteLed(strip: number, on: boolean): number[] {
  return encodeLed(MCU_NOTE_MUTE_BASE + strip, on);
}

export function encodeSelectLed(strip: number, on: boolean): number[] {
  return encodeLed(MCU_NOTE_SELECT_BASE + strip, on);
}

export function encodeSoloLed(strip: number, on: boolean): number[] {
  return encodeLed(MCU_NOTE_SOLO_BASE + strip, on);
}

export function encodeEncoderRing(strip: number, mode: number, position: number): number[] {
  const clampedMode = clampNumber(Math.round(mode), 0, 3);
  const maxPosition = clampedMode === 3 ? 6 : 11;
  const clampedPosition = clampNumber(Math.round(position), 0, maxPosition);
  const value = (clampedPosition & 0x0f) | ((clampedMode & 0x03) << 4);
  return [MCU_STATUS_CONTROL_CHANGE, MCU_CC_VPOT_RING_BASE + strip, value];
}

export function encodeMeter(strip: number, segment: number): number[] {
  const clamped = clampNumber(Math.round(segment), 0, 0x0e);
  return [MCU_STATUS_CHANNEL_PRESSURE, ((strip & 0x07) << 4) | clamped];
}

export function dbToMeterSegment(db: number, minDb = -60, maxDb = 0, maxSegment = 12): number {
  if (!Number.isFinite(db) || db <= minDb) return 0;
  const normalized = Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
  return Math.min(maxSegment, Math.max(0, Math.round(normalized * maxSegment)));
}

function sanitiseLcdText(text: string, length: number): number[] {
  const truncated = Array.from(text).slice(0, length);
  const bytes = truncated.map((character) => {
    const code = character.codePointAt(0) ?? 0x20;
    return code >= 0x20 && code <= 0x7e ? code : 0x20;
  });
  while (bytes.length < length) bytes.push(0x20);
  return bytes;
}

export interface LcdTextOptions {
  deviceByte: number;
  row: 0 | 1;
  column: number;
  width?: number;
  text: string;
}

export function encodeLcdText(options: LcdTextOptions): number[] {
  const width = options.width ?? 7;
  const offset = options.row * 56 + options.column;
  if (offset < 0 || offset + width > 112) {
    throw new RangeError(`LCD offset ${offset} with width ${width} is outside the 112 character display`);
  }
  return [...MCU_SYSEX_HEADER, options.deviceByte, 0x12, offset, ...sanitiseLcdText(options.text, width), 0xf7];
}

export function encodeLcdStripText(
  deviceByte: number,
  strip: number,
  row: 0 | 1,
  text: string,
  width = 7,
): number[] {
  return encodeLcdText({ deviceByte, row, column: strip * width, width, text });
}

export function encodeLcdStripColors(deviceByte: number, colors: readonly LcdColor[]): number[] {
  if (colors.length !== MCU_STRIPS) {
    throw new RangeError(`Expected ${MCU_STRIPS} LCD colours, received ${colors.length}`);
  }
  return [
    ...MCU_SYSEX_HEADER,
    deviceByte,
    0x72,
    ...colors.map((color) => LCD_COLOR_CODES[color]),
    0xf7,
  ];
}
