import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { parseConfig, type MidiConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { MidiDeviceManager, type MidiDeviceEvent, type MidiDeviceStatus } from "../src/midi/deviceManager.js";
import { VirtualMidiBackend } from "../src/midi/virtualBackend.js";

const logger = createLogger("error", { sink: () => undefined });

const MAIN_PORT = "X-Touch";
const DUPLICATE_PORT = "X-Touch Extender";

function extenderConfig(occurrences: [number, number] = [0, 1]): MidiConfig {
  return parseConfig({
    midi: {
      rescanIntervalMs: 60_000,
      devices: [
        { role: "main", input: MAIN_PORT, output: MAIN_PORT },
        {
          role: "extender1",
          input: { name: DUPLICATE_PORT, occurrence: occurrences[0] },
          output: { name: DUPLICATE_PORT, occurrence: occurrences[0] },
        },
        {
          role: "extender2",
          input: { name: DUPLICATE_PORT, occurrence: occurrences[1] },
          output: { name: DUPLICATE_PORT, occurrence: occurrences[1] },
        },
      ],
    },
    mapping: { master: { enabled: false } },
    logLevel: "error",
  }).midi;
}

function mainOnlyConfig(): MidiConfig {
  return parseConfig({
    midi: {
      rescanIntervalMs: 60_000,
      devices: [{ role: "main", input: MAIN_PORT, output: MAIN_PORT }],
    },
    mapping: { master: { enabled: false } },
    logLevel: "error",
  }).midi;
}

function addMain(backend: VirtualMidiBackend): void {
  backend.addDevice({ inputName: MAIN_PORT, outputName: MAIN_PORT });
}

function addExtender(backend: VirtualMidiBackend): void {
  backend.addDevice({
    inputName: DUPLICATE_PORT,
    outputName: DUPLICATE_PORT,
    allowDuplicateNames: true,
  });
}

function statusOf(manager: MidiDeviceManager, role: string): MidiDeviceStatus {
  const status = manager.statuses().find((entry) => entry.role === role);
  assert.ok(status, `status for ${role}`);
  return status;
}

function assertQuarantined(manager: MidiDeviceManager, role: string): void {
  const status = statusOf(manager, role);
  assert.equal(status.online, false);
  assert.equal(status.quarantined, true);
  assert.match(status.reason ?? "", /duplicate port name "X-Touch Extender" changed .*restart the bridge/);
}

function message(): number[] {
  return [0xb0, 0x00, 0x00];
}

describe("MIDI duplicate port name guard", () => {
  it("brings a unique main and two same-named extenders online", () => {
    const backend = new VirtualMidiBackend();
    addMain(backend);
    addExtender(backend);
    addExtender(backend);
    const manager = new MidiDeviceManager(extenderConfig(), backend, logger);

    manager.scan();

    for (const role of ["main", "extender1", "extender2"]) {
      const status = statusOf(manager, role);
      assert.equal(status.online, true, `${role} online`);
      assert.equal(status.quarantined, false, `${role} not quarantined`);
    }
  });

  it("quarantines both extenders when the first duplicate disappears and keeps the main working", () => {
    const backend = new VirtualMidiBackend();
    addMain(backend);
    addExtender(backend);
    addExtender(backend);
    const manager = new MidiDeviceManager(extenderConfig(), backend, logger);
    const events: MidiDeviceEvent[] = [];
    manager.onEvent((event) => events.push(event));
    manager.scan();

    backend.removeDeviceAt(1);
    manager.scan();

    const main = statusOf(manager, "main");
    assert.equal(main.online, true);
    assert.equal(main.quarantined, false);
    assertQuarantined(manager, "extender1");
    assertQuarantined(manager, "extender2");

    for (const role of ["extender1", "extender2"]) {
      assert.equal(
        events.some((event) => event.type === "offline" && event.role === role),
        true,
        `${role} offline event`,
      );
    }

    assert.equal(manager.send("extender1", message()), false);
    assert.equal(manager.send("extender2", message()), false);
    assert.equal(manager.send("main", message()), true);

    manager.scan();
    assertQuarantined(manager, "extender1");
    assertQuarantined(manager, "extender2");
    assert.equal(statusOf(manager, "main").online, true);
  });

  it("quarantines both extenders when the second duplicate disappears", () => {
    const backend = new VirtualMidiBackend();
    addMain(backend);
    addExtender(backend);
    addExtender(backend);
    const manager = new MidiDeviceManager(extenderConfig(), backend, logger);
    manager.scan();

    backend.removeDeviceAt(2);
    manager.scan();

    assert.equal(statusOf(manager, "main").online, true);
    assertQuarantined(manager, "extender1");
    assertQuarantined(manager, "extender2");
    assert.equal(manager.send("extender1", message()), false);
    assert.equal(manager.send("extender2", message()), false);
    assert.equal(manager.send("main", message()), true);
  });

  it("clears the quarantine with a fresh manager instance", () => {
    const backend = new VirtualMidiBackend();
    addMain(backend);
    addExtender(backend);
    addExtender(backend);
    const manager = new MidiDeviceManager(extenderConfig(), backend, logger);
    manager.scan();

    const restarted = new MidiDeviceManager(extenderConfig(), backend, logger);
    restarted.scan();

    for (const role of ["extender1", "extender2"]) {
      const status = statusOf(restarted, role);
      assert.equal(status.online, true, `${role} online after restart`);
      assert.equal(status.quarantined, false, `${role} not quarantined after restart`);
    }
    assert.equal(statusOf(restarted, "main").online, true);
  });

  it("does not quarantine a uniquely named device across unplug and replug", () => {
    const backend = new VirtualMidiBackend();
    addMain(backend);
    const manager = new MidiDeviceManager(mainOnlyConfig(), backend, logger);
    manager.scan();
    assert.equal(statusOf(manager, "main").online, true);

    backend.removeDevice(MAIN_PORT);
    manager.scan();
    assert.equal(statusOf(manager, "main").online, false);
    assert.equal(statusOf(manager, "main").quarantined, false);

    backend.addDeviceBack(MAIN_PORT);
    manager.scan();
    assert.equal(statusOf(manager, "main").online, true);
    assert.equal(statusOf(manager, "main").quarantined, false);
  });

  it("allows a late duplicate to appear before arming, then quarantines after a change", () => {
    const backend = new VirtualMidiBackend();
    addMain(backend);
    addExtender(backend);
    // Neither role can bind yet: only occurrence 0 is present, the roles want 1 and 2.
    const manager = new MidiDeviceManager(extenderConfig([1, 2]), backend, logger);

    manager.scan();
    assert.equal(statusOf(manager, "extender1").quarantined, false);
    assert.equal(statusOf(manager, "extender2").quarantined, false);

    // The extra device appears after the baseline: normal startup adoption, no quarantine.
    addExtender(backend);
    manager.scan();
    assert.equal(statusOf(manager, "extender1").online, true);
    assert.equal(statusOf(manager, "extender1").quarantined, false);
    assert.equal(statusOf(manager, "extender2").quarantined, false);

    // Now a role has been online, so the next list change is dangerous.
    backend.removeDeviceAt(1);
    manager.scan();
    assertQuarantined(manager, "extender1");
    assertQuarantined(manager, "extender2");
    assert.equal(statusOf(manager, "main").online, true);
  });

  it("logs one duplicate_ports_changed warning per guarded change", () => {
    const lines: string[] = [];
    const warnLogger = createLogger("warn", { sink: (line) => lines.push(line) });
    const backend = new VirtualMidiBackend();
    addMain(backend);
    addExtender(backend);
    addExtender(backend);
    const manager = new MidiDeviceManager(extenderConfig(), backend, warnLogger);
    manager.scan();

    backend.removeDeviceAt(1);
    manager.scan();
    manager.scan();

    const warnings = lines
      .map((line) => JSON.parse(line) as { event: string; name?: string; roles?: string[] })
      .filter((entry) => entry.event === "midi.duplicate_ports_changed");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.name, DUPLICATE_PORT);
    assert.deepEqual(warnings[0]?.roles, ["extender1", "extender2"]);
  });
});
