import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { DEFAULT_FADER_LAW, LinearDbFaderLaw, PiecewiseDbFaderLaw, XTOUCH_DB_POINTS } from "../src/mcu/faderLaw.js";

describe("linear dB fader law", () => {
  it("maps documented endpoints", () => {
    const law = new LinearDbFaderLaw();
    assert.equal(law.rawToDb(0), -100);
    assert.equal(law.rawToDb(16383), 10);
    assert.equal(law.dbToRaw(-100), 0);
    assert.equal(law.dbToRaw(10), 16383);
  });

  it("round trips representative values within one raw step", () => {
    const law = new LinearDbFaderLaw();
    for (const db of [-100, -60, -30, -12, -6, 0, 6, 10]) {
      assert.ok(Math.abs(law.rawToDb(law.dbToRaw(db)) - db) < 0.01);
    }
  });

  it("clamps values outside the documented range", () => {
    const law = new LinearDbFaderLaw();
    assert.equal(law.rawToDb(-1000), -100);
    assert.equal(law.rawToDb(99999), 10);
    assert.equal(law.dbToRaw(-200), 0);
    assert.equal(law.dbToRaw(50), 16383);
  });

  it("supports a custom range", () => {
    const law = new LinearDbFaderLaw({ minDb: -60, maxDb: 0, maxRaw: 1023 });
    assert.equal(law.rawToDb(0), -60);
    assert.equal(law.rawToDb(1023), 0);
    assert.equal(law.dbToRaw(-30), 512);
  });
});

describe("piecewise X-Touch dB fader law", () => {
  it("maps the measured anchors", () => {
    const law = new PiecewiseDbFaderLaw(XTOUCH_DB_POINTS);
    assert.equal(law.dbToRaw(-100), 0);
    assert.equal(law.dbToRaw(-60), 620);
    assert.equal(law.dbToRaw(0), 12700);
    assert.equal(law.dbToRaw(10), 16383);
    assert.equal(law.rawToDb(8380), -10);
    assert.equal(law.rawToDb(12700), 0);
  });

  it("interpolates between anchors", () => {
    const law = new PiecewiseDbFaderLaw(XTOUCH_DB_POINTS);
    assert.ok(Math.abs(law.rawToDb(7284) - -15) < 0.001);
    assert.ok(Math.abs(law.rawToDb(law.dbToRaw(-15)) - -15) < 0.001);
  });

  it("round trips representative values within the raw resolution", () => {
    const law = new PiecewiseDbFaderLaw(XTOUCH_DB_POINTS);
    for (const db of [-100, -90, -60, -50, -40, -30, -20, -10, -5, 0, 5, 10]) {
      assert.ok(Math.abs(law.rawToDb(law.dbToRaw(db)) - db) < 0.1);
    }
  });

  it("clamps values outside the measured range", () => {
    const law = new PiecewiseDbFaderLaw(XTOUCH_DB_POINTS);
    assert.equal(law.rawToDb(-500), -100);
    assert.equal(law.rawToDb(99999), 10);
    assert.equal(law.dbToRaw(-200), 0);
    assert.equal(law.dbToRaw(50), 16383);
  });

  it("rejects invalid point sets", () => {
    assert.throws(() => new PiecewiseDbFaderLaw([{ db: 0, raw: 0 }]));
    assert.throws(() => new PiecewiseDbFaderLaw([{ db: 0, raw: 0 }, { db: 1, raw: 0 }]));
    assert.throws(() => new PiecewiseDbFaderLaw([{ db: 1, raw: 0 }, { db: 0, raw: 100 }]));
  });

  it("is the default law", () => {
    assert.equal(DEFAULT_FADER_LAW.dbToRaw(0), 12700);
  });
});
