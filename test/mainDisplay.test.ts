import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import type { MainDisplayConfig, MainDisplayMode } from "../src/config.js";
import { mainDisplayCells, type MainDisplayInput } from "../src/sync/mainDisplay.js";

interface Frame {
  /** Ten cells left to right, characters only. */
  chars: string;
  /** Dot flag per cell. */
  dots: boolean[];
  /** Cells with a trailing dot per cell. */
  text: string;
}

/** Right-aligns text in ten cells; a `.` shares its cell with the digit. */
function right(text: string): string {
  return text.padStart(10 + [...text].filter((character) => character === ".").length, " ");
}

const MAIN_BUS = { kind: "bus" as const, busType: "main" as const, index: 1 };

function display(mode: MainDisplayMode, meter: MainDisplayConfig["meter"] = null): MainDisplayConfig {
  return { mode, scope: "surface", meter };
}

function frame(input: Partial<MainDisplayInput> = {}): Frame | null {
  const cells = mainDisplayCells({
    config: display("channels"),
    connected: true,
    sendAux: null,
    visibleChannels: [1, 2, 3, 4, 5, 6, 7, 8],
    onAir: null,
    meter: null,
    now: new Date(2026, 10, 24, 14, 35, 8),
    ...input,
  });
  if (cells === null) return null;
  return {
    chars: cells.map((cell) => cell.character).join(""),
    dots: cells.map((cell) => cell.dot),
    text: cells.map((cell) => `${cell.character}${cell.dot ? "." : ""}`).join(""),
  };
}

describe("main display model", () => {
  it("is blank when the mode is off", () => {
    assert.equal(frame({ config: display("off") }), null);
  });

  it("shows a gap-free channel range as two digit blocks", () => {
    const right = (text: string) => text.padStart(10, " ");
    assert.equal(frame({ visibleChannels: [1, 2, 3, 4, 5, 6, 7, 8] })?.chars, right("1  8"));
    assert.equal(
      frame({ visibleChannels: [25, 26, 27, 28, 29, 30, 31, 32] })?.chars,
      right("25  32"),
    );
    assert.equal(
      frame({ visibleChannels: [25, 26, 27, 28, 29, 30, 31, 32, 33] })?.chars,
      right("25  33"),
    );
  });

  it("falls back to the first channel when the range has gaps", () => {
    assert.equal(frame({ visibleChannels: [1, 2, 3, 5, 6] })?.chars, "1".padStart(10, " "));
    assert.equal(frame({ visibleChannels: [9] })?.chars, "9".padStart(10, " "));
    assert.equal(frame({ visibleChannels: [] }), null);
  });

  it("blanks channel and on-air content without Fairlight", () => {
    assert.equal(frame({ connected: false }), null);
    assert.equal(
      frame({ connected: false, config: display("on-air"), onAir: true }),
      null,
    );
  });

  it("shows the aux in automatic mode while sends on fader is active", () => {
    assert.equal(
      frame({ config: display("auto"), sendAux: 3 })?.chars,
      "03".padStart(10, " "),
    );
    assert.equal(frame({ config: display("auto") })?.chars, "1  8".padStart(10, " "));
  });

  it("shows on air only with a known state", () => {
    assert.equal(
      frame({ config: display("on-air"), onAir: true })?.chars,
      "    ON AIR",
    );
    assert.equal(
      frame({ config: display("on-air"), onAir: false })?.chars,
      "   OFF AIR",
    );
    assert.equal(frame({ config: display("on-air"), onAir: null }), null);
  });

  it("places the clock in the physical 3-2-2-3 groups", () => {
    const clock = frame({ config: display("clock"), connected: false });
    assert.equal(clock?.chars, " 143508   ");
    assert.deepEqual(clock?.dots, [false, false, false, false, true, false, true, false, false, false]);
  });

  it("shows integrated loudness with its sign", () => {
    const config = display("meter", { measurement: "loudness", target: MAIN_BUS });
    assert.equal(
      frame({ config, meter: { measurement: "loudness", value: -23.1 } })?.text,
      right("-23.1"),
    );
    assert.equal(
      frame({ config, meter: { measurement: "loudness", value: 5 } })?.text,
      right("5.0"),
    );
  });

  it("shows the headroom reserve without a sign", () => {
    const config = display("meter", { measurement: "headroom", target: MAIN_BUS });
    assert.equal(
      frame({ config, meter: { measurement: "headroom", value: -3.2 } })?.text,
      right("3.2"),
    );
    assert.equal(
      frame({ config, meter: { measurement: "headroom", value: 0 } })?.text,
      right("0.0"),
    );
    assert.equal(
      frame({ config, meter: { measurement: "headroom", value: -120 } })?.text,
      right("99.9"),
    );
  });

  it("blanks a meter mode without a reading or source", () => {
    const config = display("meter", { measurement: "loudness", target: MAIN_BUS });
    assert.equal(frame({ config, meter: null }), null);
    assert.equal(frame({ config, meter: { measurement: "loudness", value: null } }), null);
    assert.equal(frame({ config: display("meter") }), null);
  });
});
