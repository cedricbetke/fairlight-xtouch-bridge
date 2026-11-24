import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  blankSegmentCells,
  MCU_SEGMENT_CC_TIME_BASE,
  segmentCellsFromText,
  segmentUpdatePlan,
  sevenSegmentCode,
} from "../src/mcu/segmentDisplay.js";

function characters(cells: ReturnType<typeof segmentCellsFromText>): string {
  return cells.map((cell) => `${cell.character}${cell.dot ? "." : ""}`).join("");
}

describe("seven-segment display codec", () => {
  it("encodes digits, letters and the hyphen in the MCU range", () => {
    assert.equal(sevenSegmentCode("0"), 0x30);
    assert.equal(sevenSegmentCode("9"), 0x39);
    assert.equal(sevenSegmentCode("A"), 0x01);
    assert.equal(sevenSegmentCode("h"), 0x08);
    assert.equal(sevenSegmentCode("-"), 0x2d);
    assert.equal(sevenSegmentCode(" "), 0x20);
    assert.equal(sevenSegmentCode("_"), 0x20);
    assert.equal(sevenSegmentCode("+"), 0x20);
    assert.equal(sevenSegmentCode("AB"), 0x20);
  });

  it("right-aligns text and turns a period into a dot", () => {
    assert.equal(characters(segmentCellsFromText("25  48")), "    25  48");
    assert.equal(characters(segmentCellsFromText("14.35.08")), "    14.35.08");
    assert.equal(characters(segmentCellsFromText("42")), "        42");
  });

  it("keeps the rightmost digits when the text is too long", () => {
    assert.equal(characters(segmentCellsFromText("0123456789AB")), "23456789AB");
  });

  it("writes the rightmost digit on CC 0x40 and the leftmost on CC 0x49", () => {
    const plan = segmentUpdatePlan(segmentCellsFromText("0123456789"), null);
    assert.equal(plan.updates.length, 10);
    assert.deepEqual(
      plan.updates.map((update) => [update.cc, update.value]),
      [
        [0x49, 0x30],
        [0x48, 0x31],
        [0x47, 0x32],
        [0x46, 0x33],
        [0x45, 0x34],
        [0x44, 0x35],
        [0x43, 0x36],
        [0x42, 0x37],
        [0x41, 0x38],
        [0x40, 0x39],
      ],
    );
  });

  it("sends only changed digits with their dot flag", () => {
    const first = segmentUpdatePlan(segmentCellsFromText("14.35.08"), null);
    const unchanged = segmentUpdatePlan(segmentCellsFromText("14.35.08"), first.values);
    assert.equal(unchanged.updates.length, 0);

    const changed = segmentUpdatePlan(segmentCellsFromText("14.36.08"), first.values);
    assert.deepEqual(changed.updates, [{ index: 7, cc: 0x42, value: 0x76 }]);
    assert.equal(first.values[5], 0x74); // "4" with dot
  });

  it("clears dots when a cell becomes blank", () => {
    const dotted = segmentUpdatePlan(segmentCellsFromText("14.35.08"), null);
    const blank = segmentUpdatePlan(blankSegmentCells(), dotted.values, MCU_SEGMENT_CC_TIME_BASE);
    assert.ok(blank.updates.length > 0);
    for (const update of blank.updates) assert.equal(update.value, 0x20);
  });
});
