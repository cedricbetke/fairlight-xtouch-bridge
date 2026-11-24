import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const moduleUrl = new URL("../web/i18n.js", import.meta.url);
const i18n = (await import(moduleUrl.href)) as {
  translate: (value: string, lang?: string) => string;
  EN_MESSAGES: Record<string, string>;
  HTML_BLOCKS: Record<string, { de: string; en: string }>;
};

function stripMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

describe("i18n", () => {
  it("translates static labels into English", () => {
    assert.equal(i18n.translate("Einstellungen", "en"), "Settings");
    assert.equal(i18n.translate("Verbindung", "en"), "Connection");
    assert.equal(i18n.translate("LCD-Anzeige", "en"), "LCD display");
    assert.equal(i18n.translate("Alles gespeichert", "en"), "All saved");
    assert.equal(i18n.translate("Sprache", "en"), "Language");
  });

  it("keeps German as the source language", () => {
    assert.equal(i18n.translate("Einstellungen", "de"), "Einstellungen");
    assert.equal(i18n.translate("Gerät entfernt. Die Änderung gilt nach dem Speichern und einem Bridge-Neustart.", "de"), "Gerät entfernt. Die Änderung gilt nach dem Speichern und einem Bridge-Neustart.");
  });

  it("translates sentences built with values", () => {
    assert.equal(i18n.translate("Bank 2 / 4", "en"), "Bank 2 / 4");
    assert.equal(i18n.translate("Banking · Kanäle 9–16", "en"), "Banking · channels 9–16");
    assert.equal(i18n.translate("Fest · 3 von 8 Fadern belegt · 2 Busse", "en"), "Fixed · 3 of 8 faders assigned · 2 buses");
    assert.equal(i18n.translate("24 Eingänge, 12 Busse und 4 Monitore erkannt.", "en"), "24 inputs, 12 buses and 4 monitors detected.");
    assert.equal(i18n.translate("X-Touch Main umbenennen", "en"), "Rename X-Touch Main");
    assert.equal(i18n.translate("Fader 3: CH 01 wählen", "en"), "Select fader 3: CH 01");
    assert.equal(
      i18n.translate("F3 schaltet Monitor 1 (Control Room) auf Dim. Die LED leuchtet nur bei bestätigtem Dim-Zustand.", "en"),
      "F3 dims monitor 1 (Control Room). The LED lights only when Fairlight confirms dim.",
    );
    assert.equal(i18n.translate("Aux 2 wurde nicht erkannt. Die Belegung bleibt erhalten, die Taste bleibt wirkungslos.", "en"), "Aux 2 was not detected. The assignment is kept, but the key has no effect.");
    assert.equal(i18n.translate("Eingang X-Touch INT · nicht gefunden", "en"), "Input X-Touch INT · not found");
    assert.equal(i18n.translate("Farben aktiv · 2 Ausnahmen", "en"), "Colors on · 2 overrides");
    assert.equal(i18n.translate("Aktives Faderziel", "en"), "Active fader target");
    assert.equal(i18n.translate("Faderwert (dB)", "en"), "Fader value (dB)");
    assert.equal(i18n.translate("nicht gewählt", "en"), "not selected");
    assert.equal(i18n.translate("X-Touch Main · Erweiterung", "en"), "X-Touch Main · Expander");
    assert.equal(i18n.translate("X-Touch Main · Hauptgerät · Bank-Tasten", "en"), "X-Touch Main · Main unit · bank keys");
    assert.equal(i18n.translate("SEND ruft Drums als Aux-Mix auf. PAN schaltet zurück.", "en"), "SEND brings up Drums as the aux mix. PAN returns.");
    assert.equal(i18n.translate("MIDI-Ausgang „X-Touch INT“ wurde nicht gefunden.", "en"), "MIDI output “X-Touch INT” was not found.");
    assert.equal(i18n.translate("Demo · 24 Eingänge · 12 Busse", "en"), "Demo · 24 inputs · 12 buses");
  });

  it("keeps channel names, bus codes and identifiers unchanged", () => {
    assert.equal(i18n.translate("CH 01", "en"), "CH 01");
    assert.equal(i18n.translate("AUX 3", "en"), "AUX 3");
    assert.equal(i18n.translate("X-Touch INT · #2", "en"), "X-Touch INT · #2");
    assert.equal(i18n.translate("Drums", "en"), "Drums");
    assert.equal(i18n.translate("", "en"), "");
  });

  it("translates the labelled HTML blocks", () => {
    assert.match(stripMarkup(i18n.HTML_BLOCKS["devices.footnote"]!.en), /^Edit opens the large view/);
    assert.match(stripMarkup(i18n.HTML_BLOCKS["connection.help"]!.en), /Enable Ember\+ in Fairlight/);
  });

  it("covers every text on the settings page", () => {
    const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
    const blockSources = Object.values(i18n.HTML_BLOCKS)
      .map((block) => block.de)
      .join(" ");
    const allow = new Set([
      "Fairlight Ember Bridge",
      "Fairlight",
      "Host",
      "Port",
      "Demo",
      "Pan",
      "Encoder",
      "Banking",
      "Main",
      "Sends on Fader",
      "Monitor-Dim",
      "Monitor",
      "AUX",
      "SELECT",
      "Magenta",
      "Cyan",
      "Matrix",
      "VCA/DCA",
      "USB",
      "Deutsch",
      "English",
      "Bank 1 / 1",
    ]);
    const texts = [...html.matchAll(/>([^<>]+)</g)]
      .map((match) => (match[1] ?? "").trim())
      .filter((text) => /[a-zA-ZäöüÄÖÜß]{2}/.test(text));
    const missing = [...new Set(texts)].filter((text) => {
      if (allow.has(text)) return false;
      if (blockSources.includes(text)) return false;
      return i18n.translate(text, "en") === text;
    });
    assert.deepEqual(missing, []);
  });

  it("ships non-empty translations", () => {
    for (const [key, value] of Object.entries(i18n.EN_MESSAGES)) {
      assert.ok(key.trim() === key, `key has surrounding whitespace: "${key}"`);
      assert.ok(typeof value === "string" && value.trim() !== "", `empty translation for "${key}"`);
    }
    for (const [key, block] of Object.entries(i18n.HTML_BLOCKS)) {
      assert.ok(block.en.trim() !== "", `empty English block for "${key}"`);
      assert.notEqual(block.en, block.de, `untranslated block "${key}"`);
    }
  });
});
