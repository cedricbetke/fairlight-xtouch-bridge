import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { parseConfig } from "../src/config.js";
import {
  MockFairlightClient,
  type MockAuxSendSpec,
  type MockBusSpec,
  type MockMonitorSpec,
} from "../src/fairlight/mockClient.js";
import { createLogger } from "../src/logger.js";
import { MidiDeviceManager } from "../src/midi/deviceManager.js";
import { VirtualMidiBackend } from "../src/midi/virtualBackend.js";
import { DEFAULT_FADER_LAW } from "../src/mcu/faderLaw.js";
import { SyncEngine } from "../src/sync/engine.js";
import { VirtualMcuSurface, waitFor } from "../src/sim/virtualSurface.js";

const logger = createLogger("error", { sink: () => undefined });

interface SetupOptions {
  latencyMs?: number;
  writeExpiryMs?: number;
  maxWritesPerSecond?: number;
  singleChannelName?: string | null;
  alignMotorsOnStart?: boolean;
  alignMotorsOnBankChange?: boolean;
  resetStartupMotors?: boolean;
  channelCount?: number;
  mode?: "single" | "full";
  allowedWriteChannels?: number[];
  allowedWriteBuses?: string[];
  allowedWriteMonitors?: number[];
  layout?: unknown;
  busCount?: number;
  auxSends?: MockAuxSendSpec[];
  auxBuses?: number[];
  buses?: MockBusSpec[];
  monitors?: MockMonitorSpec[];
  sendsOnFader?: { enabled: boolean; busIndex: number };
  buttonAssignments?: Record<
    string,
    { type: "sends-on-fader"; auxIndex: number } | { type: "monitor-dim"; monitorIndex: number }
  >;
  lcd?: unknown;
  encoder?: "off" | "pan";
  meters?: boolean;
  mainDisplay?: unknown;
}

async function setup(options: SetupOptions = {}) {
  const channelCount = options.channelCount ?? 24;
  const mode = options.mode ?? "single";
  const allowedWriteChannels =
    options.allowedWriteChannels ??
    (mode === "full" ? Array.from({ length: channelCount }, (_, index) => index + 1) : [1]);
  const config = parseConfig({
    midi: {
      rescanIntervalMs: 60_000,
      devices: [
        {
          role: "main",
          input: "Virtual Main",
          output: "Virtual Main",
          encoder: options.encoder ?? "off",
          meters: options.meters ?? false,
          ...(options.mainDisplay === undefined ? {} : { mainDisplay: options.mainDisplay }),
        },
      ],
    },
    mapping: {
      singleChannel: mode === "single" ? 1 : null,
      singleChannelName: mode === "single" ? (options.singleChannelName ?? null) : null,
      master: { enabled: false },
      ...(options.sendsOnFader ? { sendsOnFader: options.sendsOnFader } : {}),
      ...(options.buttonAssignments ? { buttonAssignments: options.buttonAssignments } : {}),
      ...(options.layout ? { layout: options.layout } : {}),
    },
    ...(options.lcd ? { lcd: options.lcd } : {}),
    safety: {
      requireTouchForWrites: true,
      alignMotorsOnStart: options.alignMotorsOnStart ?? true,
      alignMotorsOnBankChange: options.alignMotorsOnBankChange ?? true,
      allowedWriteChannels,
      allowedWriteBuses: options.allowedWriteBuses ?? [],
      allowedWriteMonitors: options.allowedWriteMonitors ?? [],
      maxWritesPerSecond: options.maxWritesPerSecond ?? 10,
      writeExpiryMs: options.writeExpiryMs ?? 250,
    },
    logLevel: "error",
  });
  const backend = new VirtualMidiBackend();
  const surface = new VirtualMcuSurface(backend, [
    { role: "main", inputName: "Virtual Main", outputName: "Virtual Main" },
  ]);
  const generatedBuses = Array.from(
    new Set([...(options.auxBuses ?? []), ...(options.auxSends ?? []).map((send) => send.index)]),
  ).map((index) => ({ type: "aux" as const, index, name: `Aux ${index}` }));
  const busSpecs = options.buses ?? generatedBuses;
  const fairlight = new MockFairlightClient({
    channelCount,
    busCount: options.busCount ?? 1,
    auxSends: options.auxSends,
    buses: busSpecs.length > 0 ? busSpecs : options.buses,
    monitors: options.monitors,
    latencyMs: options.latencyMs ?? 0,
  });
  const manager = new MidiDeviceManager(config.midi, backend, logger);
  const sync = new SyncEngine({
    config,
    arming: { writes: true, motors: true },
    fairlight,
    midi: manager,
    logger,
  });
  sync.start();
  await fairlight.connect();
  manager.onEvent((event) => sync.handleDeviceEvent(event));
  manager.start();
  await waitFor(() => manager.statuses().every((status) => status.online), "virtual MIDI online");
  if ((options.alignMotorsOnStart ?? true) && !sync.status().structureLocked) {
    await waitFor(() => surface.lastMotorRaw("main", 0) !== null, "startup motor alignment");
  }
  if (options.resetStartupMotors ?? true) surface.clearSent("main");
  return { config, backend, surface, fairlight, manager, sync };
}

async function teardown(env: Awaited<ReturnType<typeof setup>>): Promise<void> {
  env.manager.stop();
  env.sync.stop();
  await env.fairlight.disconnect();
}

function lcdText(messages: number[][], device: number, strip: number, row: 0 | 1): string | null {
  const offset = row * 56 + strip * 7;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      message[0] === 0xf0 &&
      message[1] === 0x00 &&
      message[2] === 0x00 &&
      message[3] === 0x66 &&
      message[4] === device &&
      message[5] === 0x12 &&
      message[6] === offset
    ) {
      return String.fromCharCode(...message.slice(7, 14));
    }
  }
  return null;
}

/**
 * Rebuilds the current seven-segment frame from the sent Control Changes.
 * Dotted cells keep a trailing `.`, so the result is not exactly ten characters
 * when dots are present.
 */
function segmentFrame(messages: number[][]): string | null {
  const cells: string[] = Array.from({ length: 10 }, () => " ");
  let seen = false;
  for (const message of messages) {
    if (!message || message[0] !== 0xb0) continue;
    const cc = message[1] ?? -1;
    if (cc < 0x40 || cc > 0x49) continue;
    const index = 0x49 - cc;
    const value = message[2] ?? 0x20;
    const code = value & 0x3f;
    let character = " ";
    if (code >= 0x30 && code <= 0x39) character = String.fromCharCode(code);
    else if (code >= 0x01 && code <= 0x1a) character = String.fromCharCode(0x40 + code);
    else if (code === 0x2d) character = "-";
    cells[index] = `${character}${value & 0x40 ? "." : ""}`;
    seen = true;
  }
  return seen ? cells.join("") : null;
}

function lcdColors(messages: number[][], device: number): number[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      message[0] === 0xf0 &&
      message[1] === 0x00 &&
      message[2] === 0x00 &&
      message[3] === 0x66 &&
      message[4] === device &&
      message[5] === 0x72
    ) {
      return message.slice(6, 14);
    }
  }
  return null;
}

describe("sync engine", () => {
  it("aligns mapped motors to Fairlight values on startup without a touch", async () => {
    const env = await setup({ resetStartupMotors: false });
    try {
      assert.equal(env.surface.lastMotorRaw("main", 0), DEFAULT_FADER_LAW.dbToRaw(-12));
      assert.ok(env.surface.motorMessages("main", 0).length > 0);
    } finally {
      await teardown(env);
    }
  });

  it("binds a fixed bus target for motor and mute feedback", async () => {
    const layout = {
      order: ["main", "extender1", "extender2"],
      surfaces: {
        main: {
          mode: "fixed",
          fixedTargets: [
            { kind: "bus", busType: "main", index: 1 },
            null,
            null,
            null,
            null,
            null,
            null,
            null,
          ],
        },
        extender1: { mode: "banking" },
        extender2: { mode: "banking" },
      },
    };
    const env = await setup({
      mode: "full",
      layout,
      allowedWriteBuses: ["main:1"],
      resetStartupMotors: false,
    });
    try {
      assert.equal(env.surface.lastMotorRaw("main", 0), DEFAULT_FADER_LAW.dbToRaw(-6));
      env.surface.pressMute("main", 0);
      await waitFor(() => env.surface.muteLed("main", 0) === true, "bus mute LED");
      assert.equal(
        env.fairlight.snapshot().buses.find((bus) => bus.type === "main" && bus.index === 1)?.muted,
        true,
      );
    } finally {
      await teardown(env);
    }
  });

  it("can disable startup motor alignment", async () => {
    const env = await setup({ alignMotorsOnStart: false, resetStartupMotors: false });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(env.surface.lastMotorRaw("main", 0), null);
      assert.equal(env.surface.motorMessages("main").length, 0);
    } finally {
      await teardown(env);
    }
  });

  it("aligns mapped motors to the new bank after a bank change", async () => {
    const env = await setup({ mode: "full", channelCount: 48 });
    try {
      env.surface.pressBank("main", "right");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motor to align to channel 25",
      );
      assert.equal(env.surface.lastMotorRaw("main", 7), DEFAULT_FADER_LAW.dbToRaw(-11));
      assert.equal(
        env.sync.status().mapping.strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        "channel:25",
      );
    } finally {
      await teardown(env);
    }
  });

  it("can disable motor alignment on bank changes", async () => {
    const env = await setup({ mode: "full", channelCount: 48, alignMotorsOnBankChange: false });
    try {
      env.surface.pressBank("main", "right");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(env.surface.motorMessages("main").length, 0);
    } finally {
      await teardown(env);
    }
  });

  it("writes channel names to the LCD at startup", async () => {
    const env = await setup({ resetStartupMotors: false });
    try {
      const messages = env.surface.sentMessages("main");
      assert.equal(lcdText(messages, 0x14, 0, 0), "CH 01  ");
      assert.equal(lcdText(messages, 0x14, 0, 1), "CH 1   ");
    } finally {
      await teardown(env);
    }
  });

  it("updates LCD names after a bank change", async () => {
    const env = await setup({ mode: "full", channelCount: 48 });
    try {
      env.surface.pressBank("main", "right");
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 0) === "CH 25  ",
        "LCD bank update",
      );
    } finally {
      await teardown(env);
    }
  });

  it("updates the LCD when a channel is renamed", async () => {
    const env = await setup();
    try {
      env.fairlight.injectChannelUpdate(1, { name: "NEWNAME" });
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 0) === "NEWNAME",
        "LCD rename update",
      );
    } finally {
      await teardown(env);
    }
  });

  it("paints type colours and configurable LCD lines", async () => {
    const env = await setup({
      mode: "full",
      resetStartupMotors: false,
      lcd: {
        palette: { channel: "green" },
        line1: "type-number",
        line2: "blank",
      },
    });
    try {
      const messages = env.surface.sentMessages("main");
      assert.deepEqual(lcdColors(messages, 0x14), [2, 2, 2, 2, 2, 2, 2, 2]);
      assert.equal(lcdText(messages, 0x14, 0, 0), "CH 1   ");
      assert.equal(lcdText(messages, 0x14, 0, 1), "       ");
    } finally {
      await teardown(env);
    }
  });

  it("shows confirmed fader values on a configurable LCD line", async () => {
    const env = await setup({
      mode: "full",
      resetStartupMotors: false,
      lcd: { line1: "name", line2: "value" },
    });
    try {
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 1) === "-12.0dB",
        "channel level on the LCD",
      );
      env.fairlight.injectChannelUpdate(1, { levelDb: -6.5 });
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 1) === "-6.5dB ",
        "updated channel level on the LCD",
      );
    } finally {
      await teardown(env);
    }
  });

  it("shows the active send and its level on configurable LCD lines", async () => {
    const env = await setup({
      mode: "full",
      resetStartupMotors: false,
      auxSends: [{ index: 2, levelDb: -20 }],
      sendsOnFader: { enabled: true, busIndex: 2 },
      lcd: { line1: "target", line2: "value" },
    });
    try {
      env.surface.pressAssign("main", "send");
      await waitFor(() => env.sync.status().faderMode === "send", "send mode");
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 0) === "AUX 2  ",
        "send target on the LCD",
      );
      assert.equal(lcdText(env.surface.sentMessages("main"), 0x14, 0, 1), "-20.0dB");

      env.fairlight.injectAuxSendUpdate(1, 2, { levelDb: -9 });
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 1) === "-9.0dB ",
        "send level on the LCD",
      );

      env.fairlight.removeAuxSend(2, 2);
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 1, 0) === "NO SEND",
        "missing send target on the LCD",
      );
      assert.equal(lcdText(env.surface.sentMessages("main"), 0x14, 1, 1), "NO SEND");
    } finally {
      await teardown(env);
    }
  });

  it("applies per-channel LCD overrides and ignores stale names", async () => {
    const env = await setup({
      mode: "full",
      resetStartupMotors: false,
      lcd: {
        overrides: [
          {
            target: { kind: "channel", channel: 1 },
            color: "red",
            name: "MOD",
            expectedName: "CH 01",
          },
        ],
      },
    });
    try {
      let messages = env.surface.sentMessages("main");
      assert.deepEqual(lcdColors(messages, 0x14), [1, 7, 7, 7, 7, 7, 7, 7]);
      assert.equal(lcdText(messages, 0x14, 0, 0), "MOD    ");

      env.surface.clearSent("main");
      env.fairlight.injectChannelUpdate(1, { name: "STUDIO" });
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 0) === "STUDIO ",
        "LCD override released after rename",
      );
      messages = env.surface.sentMessages("main");
      assert.equal(lcdColors(messages, 0x14)?.[0], 7);
    } finally {
      await teardown(env);
    }
  });

  it("does not send LCD colours when they are disabled", async () => {
    const env = await setup({ resetStartupMotors: false, lcd: { colorsEnabled: false } });
    try {
      const messages = env.surface.sentMessages("main");
      assert.equal(lcdColors(messages, 0x14), null);
      assert.equal(lcdText(messages, 0x14, 0, 0), "CH 01  ");
    } finally {
      await teardown(env);
    }
  });

  it("does not write faders without a touch when touch protection is enabled", async () => {
    const env = await setup();
    try {
      env.surface.moveFader("main", 0, -20);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(env.fairlight.writes.length, 0);
      assert.equal(env.surface.motorMessages("main").length, 0);
    } finally {
      await teardown(env);
    }
  });

  it("coalesces rapid fader writes and aligns the motor after release", async () => {
    const env = await setup();
    try {
      env.surface.touch("main", 0, true);
      for (const db of [-20, -30, -40, -10, -5]) env.surface.moveFader("main", 0, db);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -5) < 0.02,
        "final fader value to reach Fairlight",
      );
      const levelWrites = env.fairlight.writes.filter((write) => write.kind === "channel-level");
      assert.ok(levelWrites.length >= 1);
      assert.ok(levelWrites.length <= 3, `expected coalescing, got ${levelWrites.length} writes`);
      assert.equal(env.surface.motorMessages("main").length, 0);
      env.surface.touch("main", 0, false);
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-5),
        "motor to align to the confirmed value",
      );
    } finally {
      await teardown(env);
    }
  });

  it("holds the motor still while touched, then resyncs to the latest Fairlight value", async () => {
    const env = await setup();
    try {
      env.surface.touch("main", 0, true);
      env.surface.touch("main", 0, false);
      await waitFor(() => env.surface.lastMotorRaw("main", 0) !== null, "initial motor alignment");

      env.surface.clearSent("main");
      env.surface.touch("main", 0, true);
      env.fairlight.injectChannelUpdate(1, { levelDb: -15 });
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(env.surface.motorMessages("main").length, 0);
      env.surface.touch("main", 0, false);
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-15),
        "motor to move to the Fairlight value after release",
      );
    } finally {
      await teardown(env);
    }
  });

  it("uses confirmed Fairlight state for mute and LED feedback", async () => {
    const env = await setup();
    try {
      env.surface.pressMute("main", 0);
      await waitFor(() => env.fairlight.snapshot().channels[0]?.muted === true, "mute to reach Fairlight");
      await waitFor(() => env.surface.muteLed("main", 0) === true, "mute LED on");
      env.surface.pressMute("main", 0);
      await waitFor(() => env.fairlight.snapshot().channels[0]?.muted === false, "unmute to reach Fairlight");
      await waitFor(() => env.surface.muteLed("main", 0) === false, "mute LED off");
    } finally {
      await teardown(env);
    }
  });

  it("drops fader writes when arming is revoked", async () => {
    const env = await setup();
    try {
      env.sync.setArming({ writes: false, motors: true });
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -25);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(env.fairlight.writes.length, 0);
      env.surface.touch("main", 0, false);
      assert.equal(env.surface.motorMessages("main").length, 0);
    } finally {
      await teardown(env);
    }
  });

  it("drops fader values that waited longer than the expiry window", async () => {
    const env = await setup({ latencyMs: 400, writeExpiryMs: 150, maxWritesPerSecond: 20 });
    try {
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -20);
      env.surface.moveFader("main", 0, -10);
      await waitFor(() => env.fairlight.writes.length > 0, "first write to complete", 3000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const levelWrites = env.fairlight.writes.filter((write) => write.kind === "channel-level");
      assert.equal(levelWrites.length, 1);
      assert.ok(Math.abs(Number(levelWrites[0]?.value) - -20) < 0.02);
      env.surface.touch("main", 0, false);
    } finally {
      await teardown(env);
    }
  });

  it("blocks a strip after an unconfirmed write until Fairlight reports a fresh value", async () => {
    const env = await setup();
    try {
      env.fairlight.failNextWrite(new Error("simulated timeout"));
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -20);
      await waitFor(
        () => env.sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.writeFault === "level",
        "write fault to block the strip",
      );
      env.surface.moveFader("main", 0, -10);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(env.fairlight.writes.filter((write) => write.kind === "channel-level").length, 0);
      env.surface.touch("main", 0, false);
      assert.equal(env.surface.motorMessages("main").length, 0);

      env.fairlight.injectChannelUpdate(1, { levelDb: -15 });
      await waitFor(
        () => env.sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.writeFault === null,
        "fresh Fairlight value to clear the write fault",
      );
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -12);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -12) < 0.02,
        "recovered fader write",
      );
    } finally {
      await teardown(env);
    }
  });

  it("locks writes immediately on a structure alert and accepts the new structure without a restart", async () => {
    const env = await setup();
    try {
      env.fairlight.injectStructureChangeDetected("show edit");
      await waitFor(() => env.sync.status().structureLocked, "structure lock");

      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -25);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(env.fairlight.writes.length, 0);
      env.surface.touch("main", 0, false);

      env.fairlight.injectChannelUpdate(1, { name: "OTHER" });
      env.fairlight.injectStructureChanged({
        addedChannels: [],
        removedChannels: [],
        renamedChannels: [{ index: 1, before: "CH 01", after: "OTHER" }],
        addedBuses: [],
        removedBuses: [],
      });
      env.fairlight.injectSnapshot();
      await waitFor(() => !env.sync.status().structureLocked, "structure to be accepted automatically");

      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -12);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -12) < 0.02,
        "write after structure acceptance",
      );
    } finally {
      await teardown(env);
    }
  });

  it("accepts added channels automatically without a restart", async () => {
    const env = await setup({ mode: "full", channelCount: 36 });
    try {
      env.fairlight.addChannel(37, "NEW 37", -20);
      env.fairlight.addChannel(38, "NEW 38", -22);
      env.fairlight.injectStructureChangeDetected("channels added");
      env.fairlight.injectStructureChanged({
        addedChannels: [37, 38],
        removedChannels: [],
        renamedChannels: [],
        addedBuses: [],
        removedBuses: [],
      });
      env.fairlight.injectSnapshot();
      await waitFor(() => !env.sync.status().structureLocked, "added channels accepted");
      assert.equal(env.sync.status().mapping.channelCount, 38);
      assert.equal(
        env.sync.status().mapping.strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        "channel:1",
      );

      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -18);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -18) < 0.02,
        "write after added channels",
      );
    } finally {
      await teardown(env);
    }
  });

  it("accepts a changed structure after a Fairlight reconnect", async () => {
    const env = await setup({ mode: "full", channelCount: 36 });
    try {
      env.fairlight.injectStructureChangeDetected("show edit");
      await waitFor(() => env.sync.status().structureLocked, "structure lock");

      env.fairlight.injectDisconnect("fairlight restart");
      await waitFor(() => !env.sync.status().fairlightConnected, "Fairlight disconnect");
      env.fairlight.addChannel(37, "NEW 37", -20);
      await env.fairlight.connect();
      await waitFor(() => !env.sync.status().structureLocked, "structure accepted on reconnect");
      assert.equal(env.sync.status().mapping.channelCount, 37);

      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -18);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -18) < 0.02,
        "write after reconnect",
      );
    } finally {
      await teardown(env);
    }
  });

  it("moves pan with the encoder, centres on push and follows the LED ring", async () => {
    const env = await setup({ mode: "full", encoder: "pan" });
    try {
      env.surface.clearSent("main");
      env.surface.turnEncoder("main", 0, 5);
      await waitFor(
        () => (env.fairlight.snapshot().channels[0]?.pan ?? 0) === 25,
        "pan write from encoder",
      );
      await waitFor(() => env.surface.panRing("main", 0) === 4, "pan ring right of centre");

      env.surface.turnEncoder("main", 0, -20);
      await waitFor(
        () => (env.fairlight.snapshot().channels[0]?.pan ?? 0) === -75,
        "pan moves further left",
      );
      await waitFor(() => env.surface.panRing("main", 0) === 1, "pan ring left of centre");

      env.surface.pressEncoder("main", 0);
      await waitFor(
        () => (env.fairlight.snapshot().channels[0]?.pan ?? 0) === 0,
        "encoder push centres pan",
      );
      await waitFor(() => env.surface.panRing("main", 0) === 3, "pan ring back at centre");
      const panWrites = env.fairlight.writes.filter((write) => write.kind === "channel-pan");
      assert.ok(panWrites.length >= 3);
    } finally {
      await teardown(env);
    }
  });

  it("moves an aux send with the faders when sends-on-fader is active", async () => {
    const env = await setup({
      auxSends: [{ index: 2, levelDb: -18 }],
      sendsOnFader: { enabled: true, busIndex: 2 },
    });
    try {
      env.surface.pressAssign("main", "send");
      await waitFor(() => env.sync.status().faderMode === "send", "sends-on-fader mode");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-18),
        "motor aligned to the aux send",
      );
      assert.equal(lcdText(env.surface.sentMessages("main"), 0x14, 0, 1), "AUX 2  ");

      env.surface.clearSent("main");
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -6);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.sends["aux:2"]?.levelDb ?? 0) - -6) < 0.02,
        "send level write",
      );
      assert.equal(env.fairlight.snapshot().channels[0]?.levelDb, -12);
      assert.equal(env.surface.motorMessages("main", 0).length, 0);
      env.surface.touch("main", 0, false);
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-6),
        "motor after send touch release",
      );

      env.fairlight.injectAuxSendUpdate(1, 2, { levelDb: -20 });
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-20),
        "motor following a send change",
      );

      env.surface.pressMute("main", 0);
      await waitFor(() => env.fairlight.snapshot().channels[0]?.muted === true, "channel mute in send mode");
      assert.equal(env.fairlight.snapshot().channels[0]?.sends["aux:2"]?.muted, false);

      env.surface.touch("main", 0, true);
      env.surface.pressAssign("main", "pan");
      assert.equal(env.sync.status().faderMode, "send");
      env.surface.touch("main", 0, false);

      env.surface.pressAssign("main", "pan");
      await waitFor(() => env.sync.status().faderMode === "main", "main mode");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motor back on the channel level",
      );
      await waitFor(() => lcdText(env.surface.sentMessages("main"), 0x14, 0, 1) === "CH 1   ", "channel LCD");
    } finally {
      await teardown(env);
    }
  });

  it("shows an inactive strip when the aux send is missing", async () => {
    const env = await setup({ sendsOnFader: { enabled: true, busIndex: 3 }, auxBuses: [3] });
    try {
      env.surface.pressAssign("main", "send");
      await waitFor(() => env.sync.status().faderMode === "send", "sends-on-fader mode");
      assert.equal(lcdText(env.surface.sentMessages("main"), 0x14, 0, 1), "NO SEND");
      assert.equal(env.surface.lastMotorRaw("main", 0), null);
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -6);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(env.fairlight.writes.length, 0);
    } finally {
      await teardown(env);
    }
  });

  it("drops a pending aux send when the fader mode changes", async () => {
    const env = await setup({
      auxSends: [{ index: 2, levelDb: -18 }],
      sendsOnFader: { enabled: true, busIndex: 2 },
      latencyMs: 200,
    });
    try {
      env.surface.pressAssign("main", "send");
      await waitFor(() => env.sync.status().faderMode === "send", "sends-on-fader mode");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-18),
        "send motor alignment",
      );
      env.surface.clearSent("main");
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -6);
      await waitFor(() => env.sync.status().inFlight === "main:0:level", "send write in flight");
      env.surface.moveFader("main", 0, -9);
      await waitFor(() => env.sync.status().pendingWrites > 0, "second send value queued");

      env.surface.touch("main", 0, false);
      env.surface.pressAssign("main", "pan");
      await waitFor(() => env.sync.status().faderMode === "main", "main mode during a send write");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motor back on the channel level",
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(env.surface.lastMotorRaw("main", 0), DEFAULT_FADER_LAW.dbToRaw(-12));
      assert.equal(
        env.fairlight.writes.some(
          (write) => write.kind === "channel-send-level" && write.value === -9,
        ),
        false,
      );
      assert.equal(env.fairlight.snapshot().channels[0]?.levelDb, -12);
    } finally {
      await teardown(env);
    }
  });

  it("keeps send mode across a reconnect without resending a stale send value", async () => {
    const env = await setup({
      auxSends: [{ index: 2, levelDb: -18 }],
      sendsOnFader: { enabled: true, busIndex: 2 },
      latencyMs: 200,
    });
    try {
      env.surface.pressAssign("main", "send");
      await waitFor(() => env.sync.status().faderMode === "send", "sends-on-fader mode");
      env.surface.clearSent("main");
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -6);
      await waitFor(() => env.sync.status().inFlight === "main:0:level", "send write in flight");
      env.surface.moveFader("main", 0, -9);
      await waitFor(() => env.sync.status().pendingWrites > 0, "second send value queued");

      env.fairlight.injectDisconnect("send mode simulation");
      await waitFor(() => !env.sync.status().fairlightConnected, "disconnect during a send write");
      assert.equal(env.sync.status().pendingWrites, 0);
      await new Promise((resolve) => setTimeout(resolve, 350));

      env.fairlight.injectAuxSendUpdate(1, 2, { levelDb: -25 });
      await env.fairlight.connect();
      await waitFor(() => env.sync.status().fairlightConnected, "reconnect in send mode");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
        "motor on the post-reconnect send value",
      );
      assert.equal(env.sync.status().faderMode, "send");
      assert.equal(
        env.sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        "channel:1/sends/aux:2",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        env.fairlight.writes.some((write) => write.kind === "channel-send-level" && write.value === -9),
        false,
      );
    } finally {
      await teardown(env);
    }
  });

  it("deactivates the strip when the aux send disappears", async () => {
    const env = await setup({
      auxSends: [{ index: 2, levelDb: -18 }],
      sendsOnFader: { enabled: true, busIndex: 2 },
    });
    try {
      env.surface.pressAssign("main", "send");
      await waitFor(() => env.sync.status().faderMode === "send", "sends-on-fader mode");
      env.surface.clearSent("main");
      env.fairlight.removeAuxSend(1, 2);
      await waitFor(
        () => lcdText(env.surface.sentMessages("main"), 0x14, 0, 1) === "NO SEND",
        "missing send LCD",
      );
      assert.equal(
        env.sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        null,
      );
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -6);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(env.fairlight.writes.length, 0);
      assert.equal(env.fairlight.snapshot().channels[0]?.levelDb, -12);
    } finally {
      await teardown(env);
    }
  });

  it("switches between aux mixes with the function buttons", async () => {
    const env = await setup({
      auxSends: [
        { index: 1, levelDb: -10 },
        { index: 2, levelDb: -20 },
      ],
      sendsOnFader: { enabled: true, busIndex: 1 },
      buttonAssignments: {
        f1: { type: "sends-on-fader", auxIndex: 1 },
        f2: { type: "sends-on-fader", auxIndex: 2 },
        f4: { type: "sends-on-fader", auxIndex: 4 },
      },
    });
    try {
      env.surface.pressFunction("main", "f2");
      await waitFor(() => env.sync.status().activeAux === 2, "aux 2 via F2");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-20),
        "motor on aux 2",
      );
      assert.equal(
        env.sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        "channel:1/sends/aux:2",
      );
      assert.equal(lcdText(env.surface.sentMessages("main"), 0x14, 0, 1), "AUX 2  ");

      env.surface.pressFunction("main", "f1");
      await waitFor(() => env.sync.status().activeAux === 1, "aux 1 via F1");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-10),
        "motor on aux 1",
      );
      assert.equal(lcdText(env.surface.sentMessages("main"), 0x14, 0, 1), "AUX 1  ");

      env.surface.touch("main", 0, true);
      env.surface.pressFunction("main", "f2");
      assert.equal(env.sync.status().activeAux, 1);
      env.surface.touch("main", 0, false);

      env.surface.pressFunction("main", "f3");
      assert.equal(env.sync.status().activeAux, 1);

      env.surface.pressFunction("main", "f4");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(env.sync.status().activeAux, 1);

      env.surface.pressAssign("main", "pan");
      await waitFor(() => env.sync.status().activeAux === null, "back to main via PAN");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motor on the channel level",
      );
    } finally {
      await teardown(env);
    }
  });

  it("does not write read-only or disallowed aux sends", async () => {
    const readOnly = await setup({
      auxSends: [{ index: 2, levelDb: -18, writableLevel: false }],
      sendsOnFader: { enabled: true, busIndex: 2 },
    });
    try {
      readOnly.surface.pressAssign("main", "send");
      await waitFor(() => readOnly.sync.status().faderMode === "send", "read-only send mode");
      readOnly.surface.clearSent("main");
      readOnly.surface.touch("main", 0, true);
      readOnly.surface.moveFader("main", 0, -6);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(readOnly.fairlight.writes.length, 0);
    } finally {
      await teardown(readOnly);
    }

    const disallowed = await setup({
      auxSends: [{ index: 2, levelDb: -18 }],
      sendsOnFader: { enabled: true, busIndex: 2 },
      allowedWriteChannels: [],
      alignMotorsOnStart: false,
    });
    try {
      disallowed.surface.pressAssign("main", "send");
      await waitFor(() => disallowed.sync.status().faderMode === "send", "disallowed send mode");
      disallowed.surface.clearSent("main");
      disallowed.surface.touch("main", 0, true);
      disallowed.surface.moveFader("main", 0, -6);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(disallowed.fairlight.writes.length, 0);
      assert.equal(disallowed.surface.lastMotorRaw("main", 0), null);
    } finally {
      await teardown(disallowed);
    }
  });

  it("runs assignments from the right-hand X-Touch keys", async () => {
    const env = await setup({
      auxSends: [
        { index: 1, levelDb: -10 },
        { index: 2, levelDb: -20 },
      ],
      sendsOnFader: { enabled: true, busIndex: 1 },
      allowedWriteMonitors: [1],
      monitors: [{ index: 1 }],
      buttonAssignments: {
        play: { type: "sends-on-fader", auxIndex: 2 },
        marker: { type: "monitor-dim", monitorIndex: 1 },
      },
    });
    try {
      env.surface.pressFunction("main", "play");
      await waitFor(() => env.sync.status().activeAux === 2, "aux 2 via PLAY");
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-20),
        "motor on aux 2",
      );
      await waitFor(() => env.surface.functionLed("main", "play") === true, "PLAY LED on");

      env.surface.pressAssign("main", "pan");
      await waitFor(() => env.sync.status().activeAux === null, "back to main via PAN");
      await waitFor(() => env.surface.functionLed("main", "play") === false, "PLAY LED off");

      env.surface.clearSent("main");
      env.surface.pressFunction("main", "marker");
      await waitFor(() => env.surface.functionLed("main", "marker") === true, "MARKER LED on");
      assert.equal(
        env.fairlight.snapshot().monitors.find((monitor) => monitor.index === 1)?.dimmed,
        true,
      );

      env.surface.pressFunction("main", "marker");
      await waitFor(() => env.surface.functionLed("main", "marker") === false, "MARKER LED off");
      assert.equal(
        env.fairlight.snapshot().monitors.find((monitor) => monitor.index === 1)?.dimmed,
        false,
      );
    } finally {
      await teardown(env);
    }
  });

  it("toggles monitor dim from a function button and mirrors the confirmed state", async () => {
    const env = await setup({
      allowedWriteMonitors: [2],
      monitors: [{ index: 1 }, { index: 2 }],
      buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 2 } },
    });
    try {
      env.surface.clearSent("main");
      env.surface.pressFunction("main", "f3");
      await waitFor(
        () => env.fairlight.snapshot().monitors.find((monitor) => monitor.index === 2)?.dimmed === true,
        "monitor 2 dim on",
      );
      await waitFor(() => env.surface.functionLed("main", "f3") === true, "F3 LED on");

      env.surface.pressFunction("main", "f3");
      await waitFor(() => env.surface.functionLed("main", "f3") === false, "F3 LED off");
      assert.deepEqual(
        env.fairlight.writes.filter((write) => write.kind === "monitor-dim").map((write) => write.value),
        [true, false],
      );

      env.fairlight.injectMonitorUpdate(2, { dimmed: true });
      await waitFor(() => env.surface.functionLed("main", "f3") === true, "LED follows Fairlight dim");
      const writes = env.fairlight.writes.length;
      env.fairlight.injectMonitorUpdate(2, { dimmed: false });
      await waitFor(() => env.surface.functionLed("main", "f3") === false, "LED follows Fairlight dim off");
      assert.equal(env.fairlight.writes.length, writes);
    } finally {
      await teardown(env);
    }
  });

  it("does not write monitor dim without arming, allowlist or a writable target", async () => {
    const env = await setup({
      allowedWriteMonitors: [],
      buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 1 } },
    });
    try {
      env.surface.clearSent("main");
      env.surface.pressFunction("main", "f3");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(env.fairlight.writes.length, 0);
      assert.notEqual(env.surface.functionLed("main", "f3"), true);

      env.sync.setArming({ writes: false, motors: false });
      env.surface.pressFunction("main", "f3");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(env.fairlight.writes.length, 0);
    } finally {
      await teardown(env);
    }

    const readOnly = await setup({
      allowedWriteMonitors: [1],
      monitors: [{ index: 1, writableDim: false }],
      buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 1 } },
    });
    try {
      readOnly.surface.clearSent("main");
      readOnly.surface.pressFunction("main", "f3");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(readOnly.fairlight.writes.length, 0);
      assert.notEqual(readOnly.surface.functionLed("main", "f3"), true);
    } finally {
      await teardown(readOnly);
    }
  });

  it("turns the monitor-dim LED off on disconnect and keeps the write pending-free", async () => {
    const env = await setup({
      allowedWriteMonitors: [1],
      buttonAssignments: { f3: { type: "monitor-dim", monitorIndex: 1 } },
    });
    try {
      env.surface.clearSent("main");
      env.surface.pressFunction("main", "f3");
      await waitFor(() => env.surface.functionLed("main", "f3") === true, "F3 LED on");

      env.fairlight.injectDisconnect();
      await waitFor(() => env.surface.functionLed("main", "f3") === false, "F3 LED off after disconnect");

      const writes = env.fairlight.writes.length;
      env.surface.pressFunction("main", "f3");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(env.fairlight.writes.length, writes);
    } finally {
      await teardown(env);
    }
  });

  it("ignores encoder movement when the encoder function is off", async () => {
    const env = await setup({ mode: "full" });
    try {
      env.surface.clearSent("main");
      env.surface.turnEncoder("main", 0, 3);
      env.surface.pressEncoder("main", 0);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(env.fairlight.writes.length, 0);
      assert.equal(env.surface.panRing("main", 0), null);
    } finally {
      await teardown(env);
    }
  });

  it("forwards meters to the LED chains when enabled and clears them on a bank change", async () => {
    const env = await setup({ mode: "full", channelCount: 48, meters: true });
    try {
      env.surface.clearSent("main");
      env.fairlight.injectChannelUpdate(1, { meterDb: -12 });
      await waitFor(() => env.surface.meterSegment("main", 0) === 10, "meter segment");

      env.surface.pressBank("main", "right");
      await waitFor(() => env.surface.meterSegment("main", 0) === 0, "meters cleared after bank change");
    } finally {
      await teardown(env);
    }
  });

  it("does not send meters when they are disabled", async () => {
    const env = await setup({ mode: "full" });
    try {
      env.surface.clearSent("main");
      env.fairlight.injectChannelUpdate(1, { meterDb: -6 });
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(env.surface.meterSegment("main", 0), null);
    } finally {
      await teardown(env);
    }
  });

  it("locks writes when the configured single-channel name does not match", async () => {
    const env = await setup({ singleChannelName: "EXPECTED NAME" });
    try {
      assert.equal(env.sync.status().structureLocked, true);
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -20);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(env.fairlight.writes.length, 0);

      env.fairlight.injectChannelUpdate(1, { name: "EXPECTED NAME" });
      env.fairlight.injectSnapshot();
      await waitFor(() => !env.sync.status().structureLocked, "identity recovery");
      env.surface.touch("main", 0, false);
      env.surface.touch("main", 0, true);
      env.surface.moveFader("main", 0, -20);
      await waitFor(
        () => Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -20) < 0.02,
        "write after identity recovery",
      );

      env.surface.touch("main", 0, false);
      await waitFor(() => env.surface.lastMotorRaw("main", 0) !== null, "motor armed before rename");

      env.fairlight.injectChannelUpdate(1, { name: "OTHER" });
      await waitFor(() => env.sync.status().structureLocked, "lock after live rename");
      const armedAfterLock = env.sync.status().strips.find(
        (strip) => strip.role === "main" && strip.strip === 0,
      )?.armed;
      assert.equal(armedAfterLock, false);
      env.surface.moveFader("main", 0, -10);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(Math.abs((env.fairlight.snapshot().channels[0]?.levelDb ?? 0) - -20) < 0.02);

      env.fairlight.injectChannelUpdate(1, { name: "EXPECTED NAME" });
      await waitFor(() => !env.sync.status().structureLocked, "identity recovery after rename");
      env.surface.clearSent("main");
      env.fairlight.injectChannelUpdate(1, { levelDb: -25 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(env.surface.motorMessages("main", 0).length, 0);
      env.surface.touch("main", 0, true);
      env.surface.touch("main", 0, false);
      await waitFor(
        () => env.surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
        "motor after a new touch cycle",
      );

      env.fairlight.injectChannelUpdate(2, { name: "EXPECTED NAME" });
      await waitFor(() => env.sync.status().structureLocked, "lock on duplicate channel name");
      env.fairlight.injectChannelUpdate(2, { name: "CH 02" });
      await waitFor(() => !env.sync.status().structureLocked, "recovery after duplicate name removed");
    } finally {
      await teardown(env);
    }
  });

  it("leaves the seven-segment display untouched by default", async () => {
    const env = await setup({ mode: "full", channelCount: 48 });
    try {
      env.surface.pressBank("main", "right");
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(segmentFrame(env.surface.sentMessages("main")), null);
    } finally {
      await teardown(env);
    }
  });

  it("shows the visible channel range and follows banking", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 48,
      mainDisplay: { mode: "channels" },
      resetStartupMotors: false,
    });
    try {
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) !== null,
        "channel range on the display",
      );
      assert.equal(segmentFrame(env.surface.sentMessages("main")), "1  8".padStart(10, " "));

      env.surface.pressBank("main", "right");
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "25  32",
        "channel range after a bank change",
      );
    } finally {
      await teardown(env);
    }
  });

  it("shows the active aux on the display in automatic mode", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 8,
      auxBuses: [3],
      sendsOnFader: { enabled: true, busIndex: 3 },
      mainDisplay: { mode: "auto" },
      resetStartupMotors: false,
    });
    try {
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) === "1  8".padStart(10, " "),
        "channel range before sends on fader",
      );

      env.surface.pressAssign("main", "send");
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) === "03".padStart(10, " "),
        "aux number while sends on fader is active",
      );

      env.surface.pressAssign("main", "pan");
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) === "1  8".padStart(10, " "),
        "channel range after leaving sends on fader",
      );
    } finally {
      await teardown(env);
    }
  });

  it("shows the confirmed on-air state and clears an unknown one", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 8,
      mainDisplay: { mode: "on-air" },
      resetStartupMotors: false,
    });
    try {
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) === "OFF AIR".padStart(10, " "),
        "off-air frame",
      );

      env.fairlight.setOnAir(true);
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) === "ON AIR".padStart(10, " "),
        "on-air frame",
      );

      env.fairlight.setOnAir(null);
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "",
        "blank frame for an unknown on-air state",
      );
    } finally {
      await teardown(env);
    }
  });

  it("keeps the clock running, also without Fairlight", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 8,
      mainDisplay: { mode: "clock" },
      resetStartupMotors: false,
    });
    try {
      await waitFor(() => segmentFrame(env.surface.sentMessages("main")) !== null, "clock frame");
      const first = segmentFrame(env.surface.sentMessages("main"));
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) !== first,
        "clock tick",
        3000,
      );

      env.fairlight.injectDisconnect("clock test");
      await new Promise((resolve) => setTimeout(resolve, 60));
      const afterDisconnect = segmentFrame(env.surface.sentMessages("main"));
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) !== afterDisconnect,
        "clock after a Fairlight disconnect",
        3000,
      );
    } finally {
      await teardown(env);
    }
  });

  it("rewrites the full frame after the main unit reconnects", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 48,
      mainDisplay: { mode: "channels" },
      resetStartupMotors: false,
    });
    try {
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main")) === "1  8".padStart(10, " "),
        "initial channel frame",
      );
      env.surface.remove("main");
      env.manager.scan();
      await waitFor(
        () => env.manager.statuses().find((status) => status.role === "main")?.online === false,
        "main unit offline",
      );
      env.surface.clearSent("main");
      env.surface.restore("main");
      env.manager.scan();
      await waitFor(
        () => env.manager.statuses().find((status) => status.role === "main")?.online === true,
        "main unit online",
      );
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "1  8",
        "frame after the reconnect",
      );
      const digits = env.surface
        .sentMessages("main")
        .filter(
          (message) =>
            message[0] === 0xb0 && (message[1] ?? 0) >= 0x40 && (message[1] ?? 0) <= 0x49,
        );
      assert.equal(digits.length, 10);
    } finally {
      await teardown(env);
    }
  });

  it("clears the display when the sync engine stops", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 8,
      mainDisplay: { mode: "channels" },
      resetStartupMotors: false,
    });
    try {
      await waitFor(() => segmentFrame(env.surface.sentMessages("main")) !== null, "channel frame");
      env.sync.stop();
      assert.equal(segmentFrame(env.surface.sentMessages("main"))?.trim(), "");
    } finally {
      await teardown(env);
    }
  });

  it("shows the integrated loudness of the selected main bus", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 8,
      buses: [
        { type: "main", index: 1, name: "Main", integratedLufs: -23.1, meterDb: -3.2 },
        { type: "aux", index: 2, name: "Aux 2", integratedLufs: null, meterDb: -6 },
      ],
      mainDisplay: {
        mode: "meter",
        meter: {
          measurement: "loudness",
          target: { kind: "bus", busType: "main", index: 1 },
        },
      },
      resetStartupMotors: false,
    });
    try {
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "-23.1",
        "loudness frame",
      );

      env.fairlight.injectBusUpdate("main", 1, { integratedLufs: -18.4 });
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "-18.4",
        "updated loudness frame",
      );

      const digitsBefore = env.surface
        .sentMessages("main")
        .filter((message) => message[0] === 0xb0 && (message[1] ?? 0) >= 0x40 && (message[1] ?? 0) <= 0x49)
        .length;
      env.fairlight.injectBusUpdate("aux", 2, { meterDb: -12 });
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(segmentFrame(env.surface.sentMessages("main"))?.trim(), "-18.4");
      assert.equal(
        env.surface
          .sentMessages("main")
          .filter((message) => message[0] === 0xb0 && (message[1] ?? 0) >= 0x40 && (message[1] ?? 0) <= 0x49)
          .length,
        digitsBefore,
      );

      env.fairlight.injectDisconnect("meter display test");
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "",
        "blank frame after a disconnect",
      );

      await env.fairlight.connect();
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "-18.4",
        "loudness frame after a reconnect",
      );

      env.fairlight.removeBus("main", 1);
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "",
        "blank frame after the measured bus disappears",
      );
    } finally {
      await teardown(env);
    }
  });

  it("shows the headroom reserve of the selected bus", async () => {
    const env = await setup({
      mode: "full",
      channelCount: 8,
      buses: [{ type: "aux", index: 2, name: "Stream", meterDb: -3.2 }],
      mainDisplay: {
        mode: "meter",
        meter: {
          measurement: "headroom",
          target: { kind: "bus", busType: "aux", index: 2 },
        },
      },
      resetStartupMotors: false,
    });
    try {
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "3.2",
        "headroom frame",
      );

      env.fairlight.injectBusUpdate("aux", 2, { meterDb: -6 });
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "6.0",
        "updated headroom frame",
      );

      env.fairlight.injectDisconnect("headroom display test");
      await waitFor(
        () => segmentFrame(env.surface.sentMessages("main"))?.trim() === "",
        "blank headroom frame after a disconnect",
      );
    } finally {
      await teardown(env);
    }
  });
});
