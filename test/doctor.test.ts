import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { parseConfig, type BridgeConfig } from "../src/config.js";
import { MockFairlightClient, type MockFairlightOptions } from "../src/fairlight/mockClient.js";
import { createLogger } from "../src/logger.js";
import { VirtualMidiBackend } from "../src/midi/virtualBackend.js";
import { runDoctor, type DoctorReport } from "../src/runtime/doctor.js";

const logger = createLogger("error", { sink: () => undefined });

const ALL_CHANNELS = Array.from({ length: 24 }, (_, index) => index + 1);

function baseMapping(overrides: Record<string, unknown> = {}) {
  return {
    master: { enabled: false },
    ...overrides,
  };
}

function healthyConfig(
  mappingOverrides: Record<string, unknown> = {},
  safetyOverrides: Record<string, unknown> = {},
): BridgeConfig {
  return parseConfig({
    midi: {
      rescanIntervalMs: 60_000,
      devices: [{ role: "main", input: "X-Touch", output: "X-Touch" }],
    },
    mapping: baseMapping({
      singleChannel: 1,
      singleChannelName: "CH 01",
      master: { enabled: true, busType: "main", busIndex: 1 },
      sendsOnFader: { enabled: true, busIndex: 2 },
      buttonAssignments: {
        f1: { type: "sends-on-fader", auxIndex: 2 },
        f3: { type: "monitor-dim", monitorIndex: 2 },
      },
      ...mappingOverrides,
    }),
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: ALL_CHANNELS,
      allowedWriteBuses: ["main:1", "aux:2"],
      allowedWriteMonitors: [2],
      ...safetyOverrides,
    },
    logLevel: "error",
  });
}

const HEALTHY_FAIRLIGHT: MockFairlightOptions = {
  channelCount: 24,
  auxSends: [{ index: 2, levelDb: -10 }],
  buses: [
    { type: "main", index: 1, name: "Main" },
    { type: "aux", index: 2, name: "Aux 2" },
  ],
};

async function diagnose(
  config: BridgeConfig,
  fairlightOptions: MockFairlightOptions = HEALTHY_FAIRLIGHT,
  midiDevices: Array<{ input: string; output: string }> = [{ input: "X-Touch", output: "X-Touch" }],
): Promise<DoctorReport> {
  const backend = new VirtualMidiBackend();
  for (const device of midiDevices) {
    backend.addDevice({ inputName: device.input, outputName: device.output });
  }
  const fairlight = new MockFairlightClient({ logger, ...fairlightOptions });
  await fairlight.connect();
  try {
    return runDoctor({
      config,
      host: "127.0.0.1",
      port: 9000,
      ports: { inputs: backend.listInputs(), outputs: backend.listOutputs() },
      fairlight: { client: fairlight },
    });
  } finally {
    await fairlight.disconnect();
  }
}

function check(report: DoctorReport, id: string) {
  return report.checks.find((entry) => entry.id === id);
}

describe("startup doctor", () => {
  it("checks network devices through RTP-MIDI probes", async () => {
    const config = parseConfig({
      midi: {
        rescanIntervalMs: 60_000,
        devices: [
          { role: "main", transport: "network", network: { host: "127.0.0.1", port: 5004 } },
        ],
      },
      mapping: { master: { enabled: false } },
      logLevel: "error",
    });
    const fairlight = new MockFairlightClient({ logger, ...HEALTHY_FAIRLIGHT });
    await fairlight.connect();
    const base = {
      config,
      host: "127.0.0.1",
      port: 9000,
      ports: { inputs: [], outputs: [] },
      fairlight: { client: fairlight },
    };
    try {
      const accepted = runDoctor({
        ...base,
        network: [{ role: "main", endpoint: "127.0.0.1:5004", ok: true, reason: null }],
      });
      assert.equal(check(accepted, "midi.main")?.status, "ok");

      const rejected = runDoctor({
        ...base,
        network: [{ role: "main", endpoint: "127.0.0.1:5004", ok: false, reason: "invitation rejected" }],
      });
      assert.equal(check(rejected, "midi.main")?.status, "fail");
      assert.match(check(rejected, "midi.main")?.message ?? "", /invitation rejected/);

      const skipped = runDoctor({ ...base, network: null });
      assert.equal(check(skipped, "midi.main")?.status, "warn");
    } finally {
      await fairlight.disconnect();
    }
  });
  it("reports a fully wired setup without warnings", async () => {
    const report = await diagnose(healthyConfig());
    assert.equal(report.summary.fail, 0);
    assert.equal(report.summary.warn, 0);
    assert.equal(check(report, "midi.main")?.status, "ok");
    assert.equal(check(report, "fairlight.channels")?.status, "ok");
    assert.equal(check(report, "fairlight.master")?.status, "ok");
    assert.equal(check(report, "fairlight.single_channel")?.status, "ok");
    assert.equal(check(report, "fairlight.send_aux")?.status, "ok");
    assert.equal(check(report, "fairlight.button.f1")?.status, "ok");
    assert.equal(check(report, "fairlight.button.f3")?.status, "ok");
    assert.equal(check(report, "safety.write_allowlist")?.status, "ok");
  });

  it("fails when a configured MIDI port is missing", async () => {
    const config = healthyConfig();
    const report = await diagnose(config, HEALTHY_FAIRLIGHT, [{ input: "Other", output: "Other" }]);
    assert.equal(check(report, "midi.main")?.status, "fail");
    assert.equal(report.summary.fail, 1);
  });

  it("flags missing, read-only and unapproved monitors", async () => {
    const config = healthyConfig(
      {
        buttonAssignments: {
          f3: { type: "monitor-dim", monitorIndex: 1 },
          f4: { type: "monitor-dim", monitorIndex: 3 },
          f5: { type: "monitor-dim", monitorIndex: 2 },
        },
      },
      { allowedWriteMonitors: [] },
    );
    const report = await diagnose(config, {
      ...HEALTHY_FAIRLIGHT,
      monitors: [
        { index: 1, dimmed: false, writableDim: false },
        { index: 2, dimmed: false },
      ],
    });
    assert.equal(check(report, "fairlight.button.f3")?.status, "warn");
    assert.match(check(report, "fairlight.button.f3")?.message ?? "", /read-only/);
    assert.equal(check(report, "fairlight.button.f4")?.status, "fail");
    assert.equal(check(report, "fairlight.button.f5")?.status, "warn");
    assert.match(check(report, "fairlight.button.f5")?.message ?? "", /allowedWriteMonitors/);
  });

  it("fails when the master bus or the sends-on-fader aux is missing", async () => {
    const config = healthyConfig({
      master: { enabled: true, busType: "main", busIndex: 2 },
      sendsOnFader: { enabled: true, busIndex: 5 },
    });
    const report = await diagnose(config, {
      channelCount: 24,
      buses: [{ type: "main", index: 1, name: "Main" }],
    });
    assert.equal(check(report, "fairlight.master")?.status, "fail");
    assert.equal(check(report, "fairlight.send_aux")?.status, "fail");
  });

  it("fails on a single-channel name mismatch and on missing fixed targets", async () => {
    const mismatch = await diagnose(healthyConfig({ singleChannelName: "Wrong name" }));
    assert.equal(check(mismatch, "fairlight.single_channel")?.status, "fail");

    const fixed = parseConfig({
      midi: {
        rescanIntervalMs: 60_000,
        devices: [{ role: "main", input: "X-Touch", output: "X-Touch" }],
      },
      mapping: {
        layout: {
          order: ["main"],
          surfaces: { main: { mode: "fixed", fixedTargets: [{ kind: "channel", channel: 99 }] } },
        },
      },
      safety: { allowedWriteChannels: [99] },
      logLevel: "error",
    });
    const report = await diagnose(fixed);
    assert.equal(check(report, "fairlight.fixed_targets")?.status, "fail");
    assert.match(check(report, "fairlight.fixed_targets")?.message ?? "", /channel 99/);
  });

  it("warns when mapped targets are missing from the write allowlists", async () => {
    const config = parseConfig({
      midi: {
        rescanIntervalMs: 60_000,
        devices: [{ role: "main", input: "X-Touch", output: "X-Touch" }],
      },
      mapping: { master: { enabled: false } },
      safety: { allowedWriteChannels: [1], allowedWriteBuses: [] },
      logLevel: "error",
    });
    const report = await diagnose(config, { ...HEALTHY_FAIRLIGHT, busCount: 1, buses: undefined, auxSends: undefined });
    const allowlist = check(report, "safety.write_allowlist");
    assert.equal(allowlist?.status, "warn");
    assert.match(allowlist?.message ?? "", /7 channel/);
  });

  it("checks the main display measurement source", async () => {
    const missing = parseConfig({
      midi: {
        rescanIntervalMs: 60_000,
        devices: [
          {
            role: "main",
            input: "X-Touch",
            output: "X-Touch",
            mainDisplay: {
              mode: "meter",
              meter: {
                measurement: "headroom",
                target: { kind: "bus", busType: "aux", index: 9 },
              },
            },
          },
        ],
      },
      mapping: { master: { enabled: false } },
      logLevel: "error",
    });
    const failing = await diagnose(missing);
    assert.equal(check(failing, "fairlight.main_display")?.status, "fail");

    const available = parseConfig({
      midi: {
        rescanIntervalMs: 60_000,
        devices: [
          {
            role: "main",
            input: "X-Touch",
            output: "X-Touch",
            mainDisplay: {
              mode: "meter",
              meter: {
                measurement: "loudness",
                target: { kind: "bus", busType: "main", index: 1 },
              },
            },
          },
        ],
      },
      mapping: { master: { enabled: false } },
      logLevel: "error",
    });
    const passing = await diagnose(available, {
      ...HEALTHY_FAIRLIGHT,
      buses: [{ type: "main", index: 1, name: "Main", integratedLufs: -23.1 }],
    });
    assert.equal(check(passing, "fairlight.main_display")?.status, "ok");
  });

  it("skips both checks when requested and never fails without input", () => {
    const report = runDoctor({
      config: healthyConfig(),
      host: "127.0.0.1",
      port: 9000,
      ports: null,
      fairlight: null,
    });
    assert.equal(report.summary.fail, 0);
    assert.equal(check(report, "midi.skipped")?.status, "warn");
    assert.equal(check(report, "fairlight.skipped")?.status, "warn");
  });

  it("reports a Fairlight connection error as a failure", () => {
    const report = runDoctor({
      config: healthyConfig(),
      host: "127.0.0.1",
      port: 9000,
      ports: null,
      fairlight: { error: "connect ECONNREFUSED" },
    });
    assert.equal(check(report, "fairlight.connect")?.status, "fail");
    assert.equal(report.summary.fail, 1);
  });
});
