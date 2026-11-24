import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  dbToMeterSegment,
  decodeMcuMessage,
  encodeFader,
  encodeLcdStripColors,
  encodeLcdStripText,
  encodeLcdText,
  encodeLed,
  encodeMeter,
  encodeMuteLed,
  encodeSelectLed,
} from "../src/mcu/codec.js";

describe("MCU codec", () => {
  it("decodes 14-bit faders including the master", () => {
    assert.deepEqual(decodeMcuMessage([0xe0, 0x00, 0x00]), { type: "fader", strip: 0, raw: 0 });
    assert.deepEqual(decodeMcuMessage([0xe0, 0x7f, 0x7f]), { type: "fader", strip: 0, raw: 16383 });
    assert.deepEqual(decodeMcuMessage([0xe0, 0x00, 0x40]), { type: "fader", strip: 0, raw: 8192 });
    assert.deepEqual(decodeMcuMessage([0xe8, 0x20, 0x00]), { type: "fader", strip: 8, raw: 32 });
  });

  it("decodes strip and master touch", () => {
    assert.deepEqual(decodeMcuMessage([0x90, 0x68, 0x7f]), { type: "touch", strip: 0, touched: true });
    assert.deepEqual(decodeMcuMessage([0x90, 0x68, 0x00]), { type: "touch", strip: 0, touched: false });
    assert.deepEqual(decodeMcuMessage([0x80, 0x6e, 0x40]), { type: "touch", strip: 6, touched: false });
    assert.deepEqual(decodeMcuMessage([0x90, 0x70, 0x7f]), { type: "touch", strip: 8, touched: true });
  });

  it("decodes mute, select, solo and record as press events", () => {
    assert.deepEqual(decodeMcuMessage([0x90, 0x10, 0x7f]), {
      type: "button",
      button: "mute",
      strip: 0,
      pressed: true,
    });
    assert.deepEqual(decodeMcuMessage([0x90, 0x12, 0x00]), {
      type: "button",
      button: "mute",
      strip: 2,
      pressed: false,
    });
    assert.deepEqual(decodeMcuMessage([0x90, 0x1f, 0x7f]), {
      type: "button",
      button: "select",
      strip: 7,
      pressed: true,
    });
    assert.deepEqual(decodeMcuMessage([0x90, 0x0b, 0x7f]), {
      type: "button",
      button: "solo",
      strip: 3,
      pressed: true,
    });
    assert.deepEqual(decodeMcuMessage([0x90, 0x04, 0x7f]), {
      type: "button",
      button: "record",
      strip: 4,
      pressed: true,
    });
  });

  it("decodes relative encoder and jog movement", () => {
    assert.deepEqual(decodeMcuMessage([0xb0, 0x10, 0x01]), { type: "encoder", strip: 0, delta: 1 });
    assert.deepEqual(decodeMcuMessage([0xb0, 0x10, 0x41]), { type: "encoder", strip: 0, delta: -1 });
    assert.deepEqual(decodeMcuMessage([0xb0, 0x17, 0x03]), { type: "encoder", strip: 7, delta: 3 });
    assert.deepEqual(decodeMcuMessage([0xb0, 0x3c, 0x42]), { type: "jog", delta: -2 });
  });

  it("decodes bank controls and ignores release duplicates", () => {
    assert.deepEqual(decodeMcuMessage([0x90, 0x2e, 0x7f]), { type: "bank", direction: "left" });
    assert.deepEqual(decodeMcuMessage([0x90, 0x2f, 0x7f]), { type: "bank", direction: "right" });
    assert.equal(decodeMcuMessage([0x90, 0x2f, 0x00]), null);
    assert.deepEqual(decodeMcuMessage([0x90, 0x30, 0x7f]), { type: "channel-nav", direction: "left" });
    assert.deepEqual(decodeMcuMessage([0x90, 0x29, 0x7f]), { type: "assign", assign: "send" });
    assert.deepEqual(decodeMcuMessage([0x90, 0x2a, 0x7f]), { type: "assign", assign: "pan" });
    assert.equal(decodeMcuMessage([0x90, 0x29, 0x00]), null);
    assert.deepEqual(decodeMcuMessage([0x90, 0x36, 0x7f]), { type: "function", button: "f1" });
    assert.deepEqual(decodeMcuMessage([0x90, 0x3d, 0x7f]), { type: "function", button: "f8" });
    assert.equal(decodeMcuMessage([0x90, 0x36, 0x00]), null);
  });

  it("decodes the assignable right-hand keys and keeps reserved keys separate", () => {
    assert.deepEqual(decodeMcuMessage([0x90, 94, 0x7f]), { type: "function", button: "play" });
    assert.deepEqual(decodeMcuMessage([0x90, 84, 0x7f]), { type: "function", button: "marker" });
    assert.deepEqual(decodeMcuMessage([0x90, 62, 0x7f]), { type: "function", button: "midi-tracks" });
    assert.deepEqual(decodeMcuMessage([0x90, 40, 0x7f]), { type: "function", button: "track" });
    assert.equal(decodeMcuMessage([0x90, 94, 0x00]), null);
    assert.deepEqual(decodeMcuMessage([0x90, 46, 0x7f]), { type: "bank", direction: "left" });
    assert.deepEqual(decodeMcuMessage([0x90, 42, 0x7f]), { type: "assign", assign: "pan" });
  });

  it("returns null for unsupported messages", () => {
    assert.equal(decodeMcuMessage([0xf8]), null);
    assert.equal(decodeMcuMessage([0xf0, 0x00, 0x00, 0x66, 0x14, 0xf7]), null);
    assert.equal(decodeMcuMessage([0x91, 0x68, 0x7f]), null);
    assert.equal(decodeMcuMessage([]), null);
  });

  it("encodes fader positions within the 14-bit range", () => {
    assert.deepEqual(encodeFader(0, 0), [0xe0, 0x00, 0x00]);
    assert.deepEqual(encodeFader(0, 16383), [0xe0, 0x7f, 0x7f]);
    assert.deepEqual(encodeFader(8, 12345), [0xe8, 12345 & 0x7f, (12345 >> 7) & 0x7f]);
    assert.deepEqual(encodeFader(0, -5), [0xe0, 0x00, 0x00]);
    assert.deepEqual(encodeFader(0, 99999), [0xe0, 0x7f, 0x7f]);
  });

  it("encodes LEDs, ring and meter messages", () => {
    assert.deepEqual(encodeMuteLed(0, true), [0x90, 0x10, 0x7f]);
    assert.deepEqual(encodeMuteLed(3, false), [0x90, 0x13, 0x00]);
    assert.deepEqual(encodeSelectLed(7, true), [0x90, 0x1f, 0x7f]);
    assert.deepEqual(encodeLed(0x2e, true), [0x90, 0x2e, 0x7f]);
    assert.deepEqual(encodeMeter(2, 12), [0xd0, 0x2c]);
    assert.deepEqual(encodeMeter(9, 3), [0xd0, 0x13]);
    assert.equal(dbToMeterSegment(-60), 0);
    assert.equal(dbToMeterSegment(0), 12);
    assert.equal(dbToMeterSegment(-30), 6);
  });

  it("encodes seven-character LCD cells with padding and sanitising", () => {
    const frame = encodeLcdText({ deviceByte: 0x14, row: 0, column: 0, text: "Lead" });
    assert.deepEqual(frame.slice(0, 7), [0xf0, 0x00, 0x00, 0x66, 0x14, 0x12, 0x00]);
    assert.deepEqual(frame.slice(7, 11), [0x4c, 0x65, 0x61, 0x64]);
    assert.deepEqual(frame.slice(11, 14), [0x20, 0x20, 0x20]);
    assert.equal(frame.at(-1), 0xf7);
    const strip = encodeLcdStripText(0x15, 7, 1, "ABCDEFGHIJK");
    const payload = strip.slice(7, 14);
    const text = String.fromCharCode(...payload);
    assert.equal(text, "ABCDEFG");
    assert.equal(strip[6], 7 * 7 + 56);
    assert.throws(() => encodeLcdText({ deviceByte: 0x14, row: 1, column: 110, text: "x" }), RangeError);
  });

  it("encodes the eight scribble-strip background colours", () => {
    const frame = encodeLcdStripColors(0x14, [
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "off",
    ]);
    assert.deepEqual(frame, [
      0xf0, 0x00, 0x00, 0x66, 0x14, 0x72, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x00, 0xf7,
    ]);
    assert.throws(() => encodeLcdStripColors(0x15, ["red"]), RangeError);
  });
});
