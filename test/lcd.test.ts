import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { defaultLcdConfig, type LcdConfig } from "../src/config.js";
import { resolveLcdDisplay } from "../src/lcd/display.js";

function lcd(overrides: Partial<LcdConfig> = {}): LcdConfig {
  return { ...defaultLcdConfig(), ...overrides };
}

describe("LCD display resolver", () => {
  it("shows the channel name and CH number with the channel colour", () => {
    const display = resolveLcdDisplay(lcd(), { kind: "channel", index: 7, name: "Moderation" });
    assert.equal(display.top, "Moderat");
    assert.equal(display.bottom, "CH 7   ");
    assert.equal(display.color, "white");
    assert.equal(display.colorEnabled, true);
  });

  it("uses the palette colour for bus types", () => {
    const aux = resolveLcdDisplay(lcd(), { kind: "bus", busType: "aux", index: 3, name: "Kopfhörer" });
    assert.equal(aux.bottom, "AUX 3  ");
    assert.equal(aux.color, "cyan");
    const main = resolveLcdDisplay(lcd(), { kind: "bus", busType: "main", index: 1, name: "Main" });
    assert.equal(main.color, "red");
    const mtx = resolveLcdDisplay(lcd(), { kind: "bus", busType: "mtx", index: 1, name: "Stream" });
    assert.equal(mtx.color, "yellow");
    const vca = resolveLcdDisplay(lcd(), { kind: "bus", busType: "vca", index: 2, name: "Drums" });
    assert.equal(vca.bottom, "VCA 2  ");
    assert.equal(vca.color, "green");
  });

  it("renders every line mode", () => {
    const target = { kind: "channel" as const, index: 12, name: "Gast" };
    assert.equal(resolveLcdDisplay(lcd({ line1: "name", line2: "type" }), target).top, "Gast   ");
    assert.equal(resolveLcdDisplay(lcd({ line2: "type" }), target).bottom, "CH     ");
    assert.equal(resolveLcdDisplay(lcd({ line2: "number" }), target).bottom, "12     ");
    assert.equal(resolveLcdDisplay(lcd({ line1: "blank", line2: "blank" }), target).top, "       ");
    assert.equal(resolveLcdDisplay(lcd({ line1: "custom" }), target).top, "Gast   ");
  });

  it("renders confirmed levels and target labels in the value and target modes", () => {
    const target = { kind: "channel" as const, index: 7, name: "Moderation" };
    const display = resolveLcdDisplay(lcd({ line1: "name", line2: "value" }), target, { levelDb: -15.04 });
    assert.equal(display.top, "Moderat");
    assert.equal(display.bottom, "-15.0dB");

    const targetLine = resolveLcdDisplay(lcd({ line1: "target", line2: "value" }), target, { levelDb: 3 });
    assert.equal(targetLine.top, "CH 7   ");
    assert.equal(targetLine.bottom, "3.0dB  ");

    const bus = resolveLcdDisplay(lcd({ line1: "value", line2: "target" }), {
      kind: "bus",
      busType: "aux",
      index: 2,
      name: "Bühne",
    }, { levelDb: -100, targetLabel: "AUX 2" });
    assert.equal(bus.top, "-100dB ");
    assert.equal(bus.bottom, "AUX 2  ");
  });

  it("shows placeholders for unknown levels and unavailable sends", () => {
    const target = { kind: "channel" as const, index: 3, name: "Gast" };
    const unknown = resolveLcdDisplay(lcd({ line1: "value", line2: "target" }), target);
    assert.equal(unknown.top, "--     ");
    assert.equal(unknown.bottom, "CH 3   ");

    const missing = resolveLcdDisplay(lcd({ line2: "value" }), target, { unavailable: true });
    assert.equal(missing.bottom, "NO SEND");
  });

  it("applies a matching override and ignores a stale one", () => {
    const target = { kind: "channel" as const, index: 4, name: "Zuspieler" };
    const config = lcd({
      overrides: [
        {
          target: { kind: "channel", channel: 4 },
          color: "green",
          name: "ZUSP",
          expectedName: "Zuspieler",
        },
      ],
    });
    const active = resolveLcdDisplay(config, target);
    assert.equal(active.top, "ZUSP   ");
    assert.equal(active.color, "green");
    assert.equal(active.overrideActive, true);
    assert.equal(active.overrideMismatch, false);

    const renamed = resolveLcdDisplay(config, { ...target, name: "Musik" });
    assert.equal(renamed.top, "Musik  ");
    assert.equal(renamed.color, "white");
    assert.equal(renamed.overrideActive, false);
    assert.equal(renamed.overrideMismatch, true);
  });

  it("turns the colour off but keeps the configured text when colours are disabled", () => {
    const display = resolveLcdDisplay(
      lcd({ colorsEnabled: false, line1: "type-number", line2: "name" }),
      { kind: "bus", busType: "aux", index: 2, name: "Monitor" },
    );
    assert.equal(display.top, "AUX 2  ");
    assert.equal(display.bottom, "Monitor");
    assert.equal(display.color, "off");
    assert.equal(display.colorEnabled, false);
  });

  it("returns an empty display for unassigned strips", () => {
    const display = resolveLcdDisplay(lcd(), null);
    assert.equal(display.top, "       ");
    assert.equal(display.bottom, "       ");
    assert.equal(display.color, "off");
  });

  it("sanitises non-ASCII characters and truncates to seven cells", () => {
    const display = resolveLcdDisplay(lcd({ line1: "name" }), {
      kind: "channel",
      index: 1,
      name: "Bühne—lang",
    });
    assert.equal(display.top, "B hne l");
  });
});
