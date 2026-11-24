import { strict as assert } from "node:assert";

import { parseConfig, type BridgeConfig } from "../config.js";
import { MockFairlightClient, type MockFairlightOptions } from "../fairlight/mockClient.js";
import type { BusState, FairlightSnapshot } from "../fairlight/types.js";
import type { Logger } from "../logger.js";
import { dbToMeterSegment } from "../mcu/codec.js";
import { MidiDeviceManager } from "../midi/deviceManager.js";
import { VirtualMidiBackend } from "../midi/virtualBackend.js";
import { DEFAULT_FADER_LAW } from "../mcu/faderLaw.js";
import { SyncEngine } from "../sync/engine.js";
import { VirtualMcuSurface, waitFor } from "./virtualSurface.js";

const DEVICES = [
  { role: "main" as const, inputName: "Virtual X-Touch Main", outputName: "Virtual X-Touch Main" },
  { role: "extender1" as const, inputName: "Virtual X-Touch Extender 1", outputName: "Virtual X-Touch Extender 1" },
  { role: "extender2" as const, inputName: "Virtual X-Touch Extender 2", outputName: "Virtual X-Touch Extender 2" },
];

function deviceConfigs() {
  return DEVICES.map((device) => ({
    role: device.role,
    input: { name: device.inputName, occurrence: 0 },
    output: { name: device.outputName, occurrence: 0 },
    encoder: "pan",
    meters: true,
  }));
}

function near(a: number | null, b: number, epsilon = 0.02): boolean {
  return a !== null && Math.abs(a - b) <= epsilon;
}

function ringOf(pan: number): number {
  const clamped = Math.min(100, Math.max(-100, pan));
  return Math.round(((clamped + 100) / 200) * 6);
}

function meterOf(db: number): number {
  return dbToMeterSegment(db, -60, 0, 12);
}

function auxBus(snapshot: FairlightSnapshot): BusState | undefined {
  return snapshot.buses.find((bus) => bus.type === "aux" && bus.index === 1);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface SimRig {
  surface: VirtualMcuSurface;
  fairlight: MockFairlightClient;
  midi: MidiDeviceManager;
  sync: SyncEngine;
}

async function withRig(
  config: BridgeConfig,
  fairlightOptions: Omit<MockFairlightOptions, "logger">,
  logger: Logger,
  run: (rig: SimRig) => Promise<void>,
): Promise<void> {
  const backend = new VirtualMidiBackend();
  const surface = new VirtualMcuSurface(backend, DEVICES);
  const fairlight = new MockFairlightClient({ logger, ...fairlightOptions });
  const midi = new MidiDeviceManager(config.midi, backend, logger);
  const sync = new SyncEngine({
    config,
    arming: { writes: true, motors: true },
    fairlight,
    midi,
    logger,
  });

  try {
    sync.start();
    await fairlight.connect();
    midi.onEvent((event) => sync.handleDeviceEvent(event));
    midi.start();
    await waitFor(
      () => midi.statuses().every((status) => status.online),
      "all virtual MIDI devices to come online",
    );
    await run({ surface, fairlight, midi, sync });
  } finally {
    midi.stop();
    sync.stop();
    await fairlight.disconnect();
  }
}

export async function runSimulation(logger: Logger): Promise<string[]> {
  const steps = await runBankingSimulation(logger);
  steps.push(...(await runFixedLayoutSimulation(logger)));
  steps.push(...(await runInFlightSimulation(logger)));
  steps.push(...(await runSendSimulation(logger)));
  steps.push(...(await runSendSafetySimulation(logger)));
  steps.push(...(await runButtonSimulation(logger)));
  return steps;
}

async function runBankingSimulation(logger: Logger): Promise<string[]> {
  const steps: string[] = [];
  const config = parseConfig({
    fairlight: { host: "mock", port: 9000 },
    midi: {
      rescanIntervalMs: 60_000,
      devices: deviceConfigs(),
    },
    mapping: {
      bankStep: 24,
      master: { enabled: true, busType: "main", busIndex: 1 },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: [1, 25],
      allowedWriteBuses: ["main:1"],
      maxWritesPerSecond: 20,
    },
    logLevel: "info",
  });

  await withRig(config, { channelCount: 40, busCount: 1 }, logger, async ({ surface, fairlight, midi, sync }) => {
    assert.equal(fairlight.snapshot().channels.length, 40);
    const mapping = sync.status().mapping;
    assert.equal(mapping.strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target, "channel:1");
    assert.equal(mapping.strips.find((strip) => strip.role === "extender1" && strip.strip === 0)?.target, "channel:9");
    assert.equal(mapping.strips.find((strip) => strip.role === "extender2" && strip.strip === 0)?.target, "channel:17");
    assert.equal(mapping.master, "main:1");
    assert.equal(mapping.bankPages, 2);
    steps.push("40 channels discovered and mapped to three eight-strip surfaces");

    await waitFor(
      () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
      "startup motor alignment",
    );
    assert.ok(surface.motorMessages("main", 0).length > 0);
    steps.push("motors align to confirmed Fairlight values after startup");

    surface.clearSent("main");

    surface.touch("main", 0, true);
    fairlight.injectChannelUpdate(1, { levelDb: -30 });
    await delay(120);
    assert.equal(surface.motorMessages("main", 0).length, 0);
    assert.equal(fairlight.snapshot().channels[0]?.levelDb, -30);
    steps.push("Fairlight change while touched is stored without moving the motor");

    surface.moveFader("main", 0, -20);
    await waitFor(
      () => near(fairlight.snapshot().channels[0]?.levelDb ?? null, -20),
      "Fader 1 write to reach Fairlight",
    );
    assert.equal(surface.motorMessages("main", 0).length, 0);
    steps.push("touch-protected fader move writes to channel 1 without motor feedback");

    surface.touch("main", 0, false);
    const expectedRaw = DEFAULT_FADER_LAW.dbToRaw(-20);
    await waitFor(
      () => surface.lastMotorRaw("main", 0) === expectedRaw,
      "motor to align to the confirmed channel 1 level",
    );
    steps.push("motor aligns to the confirmed value after touch release");

    surface.clearSent("main");
    fairlight.injectChannelUpdate(1, { levelDb: -10 });
    await waitFor(
      () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-10),
      "motor to follow a Fairlight change",
    );
    steps.push("bidirectional motor feedback follows Fairlight changes");

    surface.pressMute("main", 0);
    await waitFor(() => fairlight.snapshot().channels[0]?.muted === true, "mute write to reach Fairlight");
    await waitFor(() => surface.muteLed("main", 0) === true, "mute LED feedback");
    surface.pressMute("main", 0);
    await waitFor(() => fairlight.snapshot().channels[0]?.muted === false, "unmute write to reach Fairlight");
    await waitFor(() => surface.muteLed("main", 0) === false, "unmute LED feedback");
    steps.push("mute button and LED feedback use confirmed Fairlight state");

    surface.touch("main", 8, true);
    surface.moveFader("main", 8, -3);
    await waitFor(() => near(fairlight.snapshot().buses[0]?.levelDb ?? null, -3), "master fader write");
    surface.touch("main", 8, false);
    await waitFor(
      () => surface.lastMotorRaw("main", 8) === DEFAULT_FADER_LAW.dbToRaw(-3),
      "master motor alignment",
    );
    steps.push("master fader is bound to the configured main bus");

    surface.clearSent("main");
    fairlight.injectChannelUpdate(1, { pan: 50 });
    await waitFor(() => surface.panRing("main", 0) === ringOf(50), "pan ring for channel 1");
    surface.turnEncoder("main", 0, 1);
    await waitFor(() => fairlight.snapshot().channels[0]?.pan === 55, "encoder pan write to reach Fairlight");
    await waitFor(() => surface.panRing("main", 0) === ringOf(55), "pan ring after encoder write");
    surface.pressEncoder("main", 0);
    await waitFor(() => fairlight.snapshot().channels[0]?.pan === 0, "encoder push to center pan");
    await waitFor(() => surface.panRing("main", 0) === ringOf(0), "centered pan ring");
    steps.push("pan ring follows Fairlight and the encoder writes and centers pan");

    surface.clearSent("main");
    fairlight.injectChannelUpdate(1, { meterDb: -20 });
    await waitFor(() => surface.meterSegment("main", 0) === meterOf(-20), "meter for channel 1");
    steps.push("meter segments follow Fairlight levels");

    fairlight.injectChannelUpdate(25, { pan: -50, meterDb: -40 });
    surface.pressBank("main", "right");
    await waitFor(() => sync.status().mapping.bankOffset === 24, "bank offset to move to the second page");
    const banked = sync.status().mapping;
    assert.equal(banked.strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target, "channel:25");
    assert.equal(banked.strips.find((strip) => strip.role === "extender1" && strip.strip === 0)?.target, "channel:33");
    assert.equal(banked.strips.some((strip) => strip.role === "extender2"), false);
    assert.equal(surface.meterSegment("main", 0), 0);
    await waitFor(() => surface.panRing("main", 0) === ringOf(-50), "ring repainted for the second bank");
    steps.push("second bank maps the remaining 16 channels and clears stale meters");

    surface.clearSent("main");
    fairlight.injectChannelUpdate(25, { meterDb: -40 });
    await waitFor(() => surface.meterSegment("main", 0) === meterOf(-40), "meter for channel 25");
    steps.push("meters after a bank change follow the new channel");

    surface.clearSent("main");
    fairlight.injectChannelUpdate(1, { meterDb: -3 });
    await delay(120);
    assert.notEqual(surface.meterSegment("main", 0), meterOf(-3));
    steps.push("meter updates from the previous bank do not leak into the new bank");

    surface.turnEncoder("main", 0, 1);
    await waitFor(
      () => fairlight.snapshot().channels.find((channel) => channel.index === 25)?.pan === -45,
      "encoder after bank to write channel 25",
    );
    steps.push("encoders address the channels of the active bank");

    surface.pressBank("main", "left");
    await waitFor(() => sync.status().mapping.bankOffset === 0, "bank offset to return to the first page");
    const restored = sync.status().mapping;
    assert.equal(restored.strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target, "channel:1");
    await waitFor(() => surface.panRing("main", 0) === ringOf(0), "ring repainted for the first bank");
    steps.push("banking back restores the first page");

    const writesBeforeOffline = fairlight.writes.length;
    fairlight.injectDisconnect("simulation disconnect");
    await waitFor(() => !sync.status().fairlightConnected, "Fairlight disconnect to reach sync engine");
    surface.touch("main", 0, true);
    surface.moveFader("main", 0, -45);
    await delay(150);
    assert.equal(fairlight.writes.length, writesBeforeOffline);
    surface.touch("main", 0, false);
    steps.push("Fairlight disconnect stops writes and motor movement");

    fairlight.injectChannelUpdate(1, { levelDb: -25 });
    await fairlight.connect();
    await waitFor(() => sync.status().fairlightConnected, "Fairlight reconnect");
    await waitFor(
      () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
      "motor to align to the post-reconnect value",
    );
    steps.push("reconnect aligns motors to the current Fairlight value");

    surface.touch("main", 0, true);
    surface.touch("main", 0, false);
    await waitFor(
      () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
      "motor to stay at the post-reconnect value",
    );
    steps.push("touch/release after reconnect keeps the current motor value");

    surface.remove("main");
    midi.scan();
    assert.equal(midi.statuses().find((status) => status.role === "main")?.online, false);
    surface.restore("main");
    midi.scan();
    assert.equal(midi.statuses().find((status) => status.role === "main")?.online, true);
    surface.clearSent("main");
    surface.touch("main", 0, true);
    surface.touch("main", 0, false);
    await waitFor(
      () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
      "motor after MIDI hotplug",
    );
    steps.push("MIDI hotplug reopens the port without stale motor writes");
  });

  return steps;
}

async function runFixedLayoutSimulation(logger: Logger): Promise<string[]> {
  const steps: string[] = [];
  const config = parseConfig({
    fairlight: { host: "mock", port: 9000 },
    midi: {
      rescanIntervalMs: 60_000,
      devices: deviceConfigs(),
    },
    mapping: {
      bankStep: 24,
      master: { enabled: false, busType: "main", busIndex: 1 },
      layout: {
        order: ["main", "extender1", "extender2"],
        surfaces: {
          main: {
            mode: "fixed",
            fixedTargets: [
              { kind: "channel", channel: 1 },
              { kind: "channel", channel: 2 },
              { kind: "bus", busType: "aux", index: 1 },
              null,
              null,
              null,
              null,
              null,
            ],
          },
          extender1: { mode: "banking", fixedTargets: [] },
          extender2: { mode: "banking", fixedTargets: [] },
        },
      },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: [1, 2],
      allowedWriteBuses: ["aux:1"],
      maxWritesPerSecond: 20,
    },
    logLevel: "info",
  });

  await withRig(
    config,
    {
      channelCount: 40,
      buses: [
        { type: "main", index: 1, name: "Main" },
        { type: "aux", index: 1, name: "Aux 1", pan: 0 },
      ],
    },
    logger,
    async ({ surface, fairlight, sync }) => {
      const mapping = sync.status().mapping;
      assert.equal(mapping.strips.find((strip) => strip.role === "main" && strip.strip === 2)?.target, "aux:1");
      assert.equal(mapping.strips.find((strip) => strip.role === "extender1" && strip.strip === 0)?.target, "channel:3");
      assert.equal(mapping.strips.find((strip) => strip.role === "extender2" && strip.strip === 0)?.target, "channel:11");
      assert.equal(mapping.bankStep, 16);
      assert.equal(mapping.bankPages, 3);
      steps.push("fixed surface holds an aux bus while the extenders bank the remaining channels");

      surface.touch("main", 2, true);
      surface.moveFader("main", 2, -10);
      await waitFor(() => near(auxBus(fairlight.snapshot())?.levelDb ?? null, -10), "fixed aux level write");
      surface.touch("main", 2, false);
      await waitFor(
        () => surface.lastMotorRaw("main", 2) === DEFAULT_FADER_LAW.dbToRaw(-10),
        "fixed aux motor alignment",
      );
      steps.push("fixed aux fader writes the bus level and aligns its motor");

      surface.pressMute("main", 2);
      await waitFor(() => auxBus(fairlight.snapshot())?.muted === true, "fixed aux mute write");
      await waitFor(() => surface.muteLed("main", 2) === true, "fixed aux mute LED");
      surface.pressMute("main", 2);
      await waitFor(() => auxBus(fairlight.snapshot())?.muted === false, "fixed aux unmute write");
      await waitFor(() => surface.muteLed("main", 2) === false, "fixed aux unmute LED");
      steps.push("fixed aux mute and LED follow confirmed Fairlight state");

      surface.clearSent("main");
      surface.turnEncoder("main", 2, 4);
      await waitFor(() => auxBus(fairlight.snapshot())?.pan === 20, "fixed aux encoder pan write");
      await waitFor(() => surface.panRing("main", 2) === ringOf(20), "fixed aux pan ring");
      surface.pressEncoder("main", 2);
      await waitFor(() => auxBus(fairlight.snapshot())?.pan === 0, "fixed aux encoder push to center");
      await waitFor(() => surface.panRing("main", 2) === ringOf(0), "fixed aux centered ring");
      steps.push("fixed aux pan uses the encoder and its ring");

      fairlight.injectBusUpdate("aux", 1, { meterDb: -30 });
      await waitFor(() => surface.meterSegment("main", 2) === meterOf(-30), "fixed aux meter");
      steps.push("fixed aux meter uses the bus level");

      fairlight.injectChannelUpdate(19, { meterDb: -36 });
      surface.pressBank("main", "right");
      await waitFor(() => sync.status().mapping.bankOffset === 16, "fixed layout bank offset");
      const banked = sync.status().mapping;
      assert.equal(banked.strips.find((strip) => strip.role === "main" && strip.strip === 2)?.target, "aux:1");
      assert.equal(banked.strips.find((strip) => strip.role === "extender1" && strip.strip === 0)?.target, "channel:19");
      assert.equal(banked.strips.find((strip) => strip.role === "extender2" && strip.strip === 0)?.target, "channel:27");
      assert.equal(surface.meterSegment("main", 2), 0);
      steps.push("bank change keeps the fixed aux strip and moves only the extenders");

      surface.clearSent("main");
      fairlight.injectBusUpdate("aux", 1, { meterDb: -12 });
      await waitFor(() => surface.meterSegment("main", 2) === meterOf(-12), "fixed aux meter after bank change");
      steps.push("fixed aux meter survives a bank change");

      surface.clearSent("extender1");
      fairlight.injectChannelUpdate(19, { meterDb: -24 });
      await waitFor(() => surface.meterSegment("extender1", 0) === meterOf(-24), "extender meter after bank change");
      steps.push("extender meters follow the channels of the new bank");

      surface.clearSent("extender1");
      fairlight.injectChannelUpdate(3, { meterDb: -3 });
      await delay(120);
      assert.notEqual(surface.meterSegment("extender1", 0), meterOf(-3));
      steps.push("meter updates from the previous bank do not leak into the new bank");

      surface.pressBank("main", "left");
      await waitFor(() => sync.status().mapping.bankOffset === 0, "fixed layout bank back");
      const restored = sync.status().mapping;
      assert.equal(restored.strips.find((strip) => strip.role === "extender1" && strip.strip === 0)?.target, "channel:3");
      steps.push("banking back restores the extenders while the fixed aux stays");
    },
  );

  return steps;
}

async function runInFlightSimulation(logger: Logger): Promise<string[]> {
  const steps: string[] = [];
  const config = parseConfig({
    fairlight: { host: "mock", port: 9000 },
    midi: {
      rescanIntervalMs: 60_000,
      devices: deviceConfigs(),
    },
    mapping: {
      bankStep: 24,
      master: { enabled: false, busType: "main", busIndex: 1 },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: [1, 9],
      allowedWriteBuses: [],
      maxWritesPerSecond: 4,
      writeExpiryMs: 2000,
    },
    logLevel: "info",
  });

  await withRig(
    config,
    { channelCount: 40, busCount: 1, latencyMs: 300 },
    logger,
    async ({ surface, fairlight, midi, sync }) => {
      fairlight.injectChannelUpdate(1, { meterDb: -20 });
      await waitFor(() => surface.meterSegment("main", 0) === meterOf(-20), "meter before disconnect");

      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -20);
      await waitFor(() => sync.status().inFlight === "main:0:level", "first fader write to be in flight");
      surface.moveFader("main", 0, -30);
      await waitFor(() => sync.status().pendingWrites > 0, "second fader value to be queued");

      fairlight.injectDisconnect("in-flight simulation");
      await waitFor(() => !sync.status().fairlightConnected, "Fairlight disconnect with a write in flight");
      assert.equal(sync.status().pendingWrites, 0);
      await waitFor(() => surface.meterSegment("main", 0) === 0, "meters to clear on disconnect");
      steps.push("Fairlight disconnect drops the queued fader value and clears meters");

      await delay(400);
      assert.equal(
        fairlight.writes.some(
          (write) => write.kind === "channel-level" && write.target === "1" && write.value === -30,
        ),
        false,
      );

      fairlight.injectChannelUpdate(1, { levelDb: -25 });
      const writesAtReconnect = fairlight.writes.length;
      await fairlight.connect();
      await waitFor(() => sync.status().fairlightConnected, "Fairlight reconnect after in-flight write");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
        "motor to follow the post-reconnect value",
      );
      await delay(300);
      assert.equal(fairlight.writes.length, writesAtReconnect);
      steps.push("reconnect aligns to the fresh value without resending the stale fader move");

      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -20);
      await waitFor(() => sync.status().inFlight === "main:0:level", "main write in flight before removing the extender");
      surface.touch("extender1", 0, true);
      surface.moveFader("extender1", 0, -30);
      await waitFor(() => sync.status().pendingWrites > 0, "extender write to be queued");

      surface.remove("extender1");
      midi.scan();
      assert.equal(midi.statuses().find((status) => status.role === "extender1")?.online, false);
      await delay(600);
      assert.equal(
        fairlight.writes.some((write) => write.kind === "channel-level" && write.target === "9"),
        false,
      );
      assert.equal(
        fairlight.writes.some(
          (write) => write.kind === "channel-level" && write.target === "1" && write.value === -20,
        ),
        true,
      );
      steps.push("a removed extender does not send its queued fader value while other surfaces keep writing");

      surface.restore("extender1");
      midi.scan();
      await waitFor(
        () => midi.statuses().find((status) => status.role === "extender1")?.online === true,
        "extender to return",
      );
      assert.equal(fairlight.snapshot().channels.find((channel) => channel.index === 9)?.levelDb, -10);
      steps.push("the restored extender keeps its Fairlight value and needs a fresh touch gesture");
    },
  );

  return steps;
}

async function runSendSimulation(logger: Logger): Promise<string[]> {
  const steps: string[] = [];
  const config = parseConfig({
    fairlight: { host: "mock", port: 9000 },
    midi: {
      rescanIntervalMs: 60_000,
      devices: deviceConfigs(),
    },
    mapping: {
      bankStep: 24,
      master: { enabled: false, busType: "main", busIndex: 1 },
      sendsOnFader: { enabled: true, busIndex: 2 },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: Array.from({ length: 40 }, (_, index) => index + 1),
      allowedWriteBuses: [],
      maxWritesPerSecond: 20,
    },
    logLevel: "info",
  });

  await withRig(
    config,
    { channelCount: 40, auxSends: [{ index: 2, levelDb: -18 }], buses: [{ type: "aux", index: 2, name: "Aux 2" }] },
    logger,
    async ({ surface, fairlight, sync }) => {
      surface.pressAssign("main", "send");
      await waitFor(() => sync.status().faderMode === "send", "sends-on-fader mode");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-18),
        "motors aligned to the aux send",
      );
      assert.equal(
        sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        "channel:1/sends/aux:2",
      );
      steps.push("SEND switches the faders to the configured aux send and aligns the motors");

      surface.clearSent("main");
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -6);
      await waitFor(
        () => near(fairlight.snapshot().channels[0]?.sends["aux:2"]?.levelDb ?? null, -6),
        "aux send level write",
      );
      assert.equal(fairlight.snapshot().channels[0]?.levelDb, -12);
      assert.equal(surface.motorMessages("main", 0).length, 0);
      surface.touch("main", 0, false);
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-6),
        "motor after aux send release",
      );
      steps.push("faders write the aux send without changing the main channel level");

      surface.pressBank("main", "right");
      await waitFor(() => sync.status().mapping.bankOffset === 24, "bank change in send mode");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-18),
        "motors aligned to the banked aux sends",
      );
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -9);
      await waitFor(
        () =>
          near(
            fairlight.snapshot().channels.find((channel) => channel.index === 25)?.sends["aux:2"]?.levelDb ?? null,
            -9,
          ),
        "aux send write on the second bank",
      );
      surface.touch("main", 0, false);
      assert.equal(fairlight.snapshot().channels.find((channel) => channel.index === 25)?.levelDb, -12);
      steps.push("banking keeps sends-on-fader bound to the new channels");

      surface.pressAssign("main", "pan");
      await waitFor(() => sync.status().faderMode === "main", "return to the main mix");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motors back on the main channel levels",
      );
      steps.push("PAN returns the faders to the main mix levels");

      surface.touch("main", 0, true);
      surface.pressAssign("main", "send");
      assert.equal(sync.status().faderMode, "main");
      surface.touch("main", 0, false);
      steps.push("SEND is ignored while a fader is touched");
    },
  );

  return steps;
}

async function runSendSafetySimulation(logger: Logger): Promise<string[]> {
  const steps: string[] = [];
  const config = parseConfig({
    fairlight: { host: "mock", port: 9000 },
    midi: {
      rescanIntervalMs: 60_000,
      devices: deviceConfigs(),
    },
    mapping: {
      bankStep: 24,
      master: { enabled: false, busType: "main", busIndex: 1 },
      sendsOnFader: { enabled: true, busIndex: 2 },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: [1],
      allowedWriteBuses: [],
      maxWritesPerSecond: 4,
      writeExpiryMs: 2000,
    },
    logLevel: "info",
  });

  await withRig(
    config,
    { channelCount: 8, auxSends: [{ index: 2, levelDb: -18 }], buses: [{ type: "aux", index: 2, name: "Aux 2" }], latencyMs: 250 },
    logger,
    async ({ surface, fairlight, sync }) => {
      surface.pressAssign("main", "send");
      await waitFor(() => sync.status().faderMode === "send", "send mode before switching back");
      surface.clearSent("main");
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -6);
      await waitFor(() => sync.status().inFlight === "main:0:level", "aux send write in flight");
      surface.moveFader("main", 0, -9);
      await waitFor(() => sync.status().pendingWrites > 0, "queued aux send value");

      surface.touch("main", 0, false);
      surface.pressAssign("main", "pan");
      await waitFor(() => sync.status().faderMode === "main", "main mode during a send write");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motor back on the channel level",
      );
      await delay(350);
      assert.equal(surface.lastMotorRaw("main", 0), DEFAULT_FADER_LAW.dbToRaw(-12));
      assert.equal(
        fairlight.writes.some((write) => write.kind === "channel-send-level" && write.value === -9),
        false,
      );
      steps.push("switching back to PAN drops a pending aux send and ignores a late confirmation");

      surface.pressAssign("main", "send");
      await waitFor(() => sync.status().faderMode === "send", "send mode before the disconnect");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-6),
        "motors back on the aux send",
      );
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -3);
      await waitFor(() => sync.status().inFlight === "main:0:level", "second aux send write in flight");
      fairlight.injectDisconnect("send safety simulation");
      await waitFor(() => !sync.status().fairlightConnected, "disconnect during an aux send write");
      assert.equal(sync.status().pendingWrites, 0);
      await delay(350);
      fairlight.injectAuxSendUpdate(1, 2, { levelDb: -25 });
      await fairlight.connect();
      await waitFor(() => sync.status().fairlightConnected, "reconnect in send mode");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-25),
        "motor on the post-reconnect aux send",
      );
      assert.equal(sync.status().faderMode, "send");
      steps.push("reconnect stays in send mode and does not resend a stale send value");

      fairlight.removeAuxSend(1, 2);
      await waitFor(
        () =>
          sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target === null,
        "strip without an aux send",
      );
      surface.clearSent("main");
      const writesBeforeMissingSend = fairlight.writes.length;
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -6);
      await delay(350);
      assert.equal(fairlight.writes.length, writesBeforeMissingSend);
      steps.push("a channel without the configured send stays inactive and writes nothing");
    },
  );

  return steps;
}

async function runButtonSimulation(logger: Logger): Promise<string[]> {
  const steps: string[] = [];
  const config = parseConfig({
    fairlight: { host: "mock", port: 9000 },
    midi: {
      rescanIntervalMs: 60_000,
      devices: deviceConfigs(),
    },
    mapping: {
      bankStep: 24,
      master: { enabled: false, busType: "main", busIndex: 1 },
      buttonAssignments: {
        f1: { type: "sends-on-fader", auxIndex: 1 },
        f2: { type: "sends-on-fader", auxIndex: 2 },
        f3: { type: "monitor-dim", monitorIndex: 2 },
        f4: { type: "sends-on-fader", auxIndex: 4 },
      },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: [1],
      allowedWriteBuses: [],
      allowedWriteMonitors: [2],
      maxWritesPerSecond: 20,
    },
    logLevel: "info",
  });

  await withRig(
    config,
    {
      channelCount: 8,
      auxSends: [
        { index: 1, levelDb: -10 },
        { index: 2, levelDb: -20 },
      ],
      buses: [
        { type: "aux", index: 1, name: "Aux 1" },
        { type: "aux", index: 2, name: "Aux 2" },
      ],
    },
    logger,
    async ({ surface, fairlight, sync }) => {
      surface.pressFunction("main", "f1");
      await waitFor(() => sync.status().activeAux === 1, "aux 1 via F1");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-10),
        "motors on aux 1",
      );
      assert.equal(
        sync.status().strips.find((strip) => strip.role === "main" && strip.strip === 0)?.target,
        "channel:1/sends/aux:1",
      );
      steps.push("a configured function button puts its aux mix on the faders");

      surface.pressFunction("main", "f2");
      await waitFor(() => sync.status().activeAux === 2, "aux 2 via F2");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-20),
        "motors on aux 2",
      );
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -4);
      await waitFor(
        () => near(fairlight.snapshot().channels[0]?.sends["aux:2"]?.levelDb ?? null, -4),
        "aux 2 fader write",
      );
      surface.touch("main", 0, false);
      steps.push("switching between function buttons changes the mix and its writes");

      surface.touch("main", 0, true);
      surface.pressFunction("main", "f1");
      assert.equal(sync.status().activeAux, 2);
      surface.touch("main", 0, false);
      surface.pressFunction("main", "f4");
      await delay(80);
      assert.equal(sync.status().activeAux, 2);
      steps.push("touched faders and unknown aux buses block the function button");

      surface.pressAssign("main", "pan");
      await waitFor(() => sync.status().activeAux === null, "main mix via PAN");
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === DEFAULT_FADER_LAW.dbToRaw(-12),
        "motors back on the main mix",
      );
      steps.push("PAN returns to the main mix from a function-button aux");

      surface.pressFunction("main", "f3");
      await waitFor(() => surface.functionLed("main", "f3") === true, "monitor dim via F3");
      await waitFor(
        () => fairlight.snapshot().monitors.find((monitor) => monitor.index === 2)?.dimmed === true,
        "monitor 2 dimmed",
      );
      assert.equal(
        fairlight.writes.filter((write) => write.kind === "monitor-dim").length,
        1,
      );
      surface.pressFunction("main", "f3");
      await waitFor(() => surface.functionLed("main", "f3") === false, "monitor dim off via F3");
      steps.push("a monitor-dim function button toggles the confirmed dim state and its LED");
    },
  );

  return steps;
}
