import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:net";

import { parseConfig, type BridgeConfig } from "../src/config.js";
import { EmberFairlightClient } from "../src/fairlight/emberClient.js";
import { MockEmberProvider } from "../src/fairlight/mockProvider.js";
import { createLogger } from "../src/logger.js";
import { DEFAULT_FADER_LAW } from "../src/mcu/faderLaw.js";
import {
  encodeFader,
  MCU_NOTE_TOUCH_BASE,
  MCU_STATUS_NOTE_ON,
} from "../src/mcu/codec.js";
import { VirtualMidiBackend } from "../src/midi/virtualBackend.js";
import { Bridge } from "../src/runtime/bridge.js";
import { VirtualMcuSurface, waitFor } from "../src/sim/virtualSurface.js";

const logger = createLogger("error", { sink: () => undefined });

const MAIN_PORT = "Endurance X-Touch Main";
const EXTENDER_PORT = "Endurance X-Touch Extender";
const EXTENDER_DUP_PORT = "Endurance X-Touch Duplicate";
const EXTENDER_DUP_OUT_1 = "Endurance Duplicate Output 1";
const EXTENDER_DUP_OUT_2 = "Endurance Duplicate Output 2";

const LEVEL_TARGETS = [-30, -20, -10, -5, 0, -15, -25, -35] as const;
const PUSH_LEVELS = [-58, -14, -2, -8, -22, -17.4, -44] as const;
const PUSH_PANS = [-60, -20, 0, 25, 70] as const;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function near(actual: number | null | undefined, expected: number, epsilon = 0.06): boolean {
  return actual !== null && actual !== undefined && Math.abs(actual - expected) <= epsilon;
}

function ringOf(pan: number): number {
  const clamped = Math.min(100, Math.max(-100, pan));
  return Math.round(((clamped + 100) / 200) * 6);
}

function quantiseLevel(db: number): number {
  return Number(db.toFixed(1));
}

function faderTargetDb(targetDb: number): number {
  return quantiseLevel(DEFAULT_FADER_LAW.rawToDb(DEFAULT_FADER_LAW.dbToRaw(targetDb)));
}

function motorRawFor(db: number): number {
  return DEFAULT_FADER_LAW.dbToRaw(quantiseLevel(db));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function deviceConfigs(duplicateExtenders: boolean) {
  const main = {
    role: "main",
    kind: "main",
    input: { name: MAIN_PORT, occurrence: 0 },
    output: { name: MAIN_PORT, occurrence: 0 },
    encoder: "pan",
    meters: true,
  };
  if (!duplicateExtenders) {
    return [
      main,
      {
        role: "extender1",
        kind: "extender",
        input: { name: EXTENDER_PORT, occurrence: 0 },
        output: { name: EXTENDER_PORT, occurrence: 0 },
        encoder: "pan",
        meters: true,
      },
    ];
  }
  return [
    main,
    {
      role: "extender1",
      kind: "extender",
      input: { name: EXTENDER_DUP_PORT, occurrence: 0 },
      output: { name: EXTENDER_DUP_OUT_1, occurrence: 0 },
      encoder: "pan",
      meters: true,
    },
    {
      role: "extender2",
      kind: "extender",
      input: { name: EXTENDER_DUP_PORT, occurrence: 1 },
      output: { name: EXTENDER_DUP_OUT_2, occurrence: 0 },
      encoder: "pan",
      meters: true,
    },
  ];
}

function enduranceConfig(port: number): BridgeConfig {
  const config = parseConfig({
    fairlight: { host: "127.0.0.1", port, requestTimeoutMs: 2000 },
    midi: { rescanIntervalMs: 250, devices: deviceConfigs(false) },
    mapping: {
      bankStep: 8,
      master: { enabled: true, busType: "main", busIndex: 1 },
      layout: {
        order: ["main", "extender1"],
        surfaces: {
          main: { mode: "fixed", fixedTargets: [1, 2, 3, 4, 5, 6, 7, 8] },
          extender1: { mode: "banking" },
        },
      },
    },
    safety: {
      requireTouchForWrites: true,
      alignMotorsOnStart: true,
      alignMotorsOnBankChange: true,
      allowedWriteChannels: Array.from({ length: 24 }, (_, index) => index + 1),
      allowedWriteBuses: ["main:1"],
      maxWritesPerSecond: 50,
      writeExpiryMs: 2000,
    },
    logLevel: "error",
  });
  // The test needs fast rescans; the public configuration floor is 250 ms.
  config.midi.rescanIntervalMs = 50;
  return config;
}

function duplicateConfig(port: number): BridgeConfig {
  const config = parseConfig({
    fairlight: { host: "127.0.0.1", port, requestTimeoutMs: 2000 },
    midi: { rescanIntervalMs: 250, devices: deviceConfigs(true) },
    mapping: {
      master: { enabled: false },
      layout: {
        order: ["main", "extender1", "extender2"],
        surfaces: {
          main: { mode: "fixed", fixedTargets: [1, 2, 3, 4, 5, 6, 7, 8] },
          extender1: { mode: "banking" },
          extender2: { mode: "banking" },
        },
      },
    },
    safety: {
      requireTouchForWrites: true,
      allowedWriteChannels: Array.from({ length: 24 }, (_, index) => index + 1),
      allowedWriteBuses: [],
      maxWritesPerSecond: 50,
      writeExpiryMs: 2000,
    },
    logLevel: "error",
  });
  config.midi.rescanIntervalMs = 50;
  return config;
}

function createClient(port: number): EmberFairlightClient {
  return new EmberFairlightClient({
    host: "127.0.0.1",
    port,
    requestTimeoutMs: 2000,
    reconnectAttempts: 0,
    autoReconnect: true,
    logger,
    subscribeMeters: true,
    watchChannelNames: [],
    watchAuxSends: [],
    watchMonitors: [],
  });
}

function levelOf(client: EmberFairlightClient, index: number): number | null {
  return client.snapshot().channels.find((channel) => channel.index === index)?.levelDb ?? null;
}

function mutedOf(client: EmberFairlightClient, index: number): boolean | null {
  return client.snapshot().channels.find((channel) => channel.index === index)?.muted ?? null;
}

function panOf(client: EmberFairlightClient, index: number): number | null {
  return client.snapshot().channels.find((channel) => channel.index === index)?.pan ?? null;
}

function stripChannel(bridge: Bridge, role: string, strip: number): number | null {
  const target = bridge
    .status()
    .sync.mapping.strips.find((entry) => entry.role === role && entry.strip === strip)?.target;
  if (!target?.startsWith("channel:")) return null;
  const channel = Number(target.slice("channel:".length));
  return Number.isInteger(channel) ? channel : null;
}

async function waitSettled(bridge: Bridge, description: string): Promise<void> {
  await waitFor(() => {
    const sync = bridge.status().sync;
    return sync.fairlightConnected && sync.pendingWrites === 0 && sync.inFlight === null;
  }, description, 5000);
}

function assertSettled(bridge: Bridge, label: string): void {
  const sync = bridge.status().sync;
  assert.equal(sync.fairlightConnected, true, `${label}: Fairlight connected`);
  assert.equal(sync.pendingWrites, 0, `${label}: no pending writes`);
  assert.equal(sync.inFlight, null, `${label}: nothing in flight`);
}

async function startBridge(
  config: BridgeConfig,
  backend: VirtualMidiBackend,
  client: EmberFairlightClient,
): Promise<Bridge> {
  const bridge = new Bridge({
    config,
    arming: { writes: true, motors: true },
    backend,
    logger,
    fairlight: client,
  });
  await bridge.start();
  await waitFor(
    () => bridge.status().devices.every((device) => device.online),
    "all virtual MIDI devices to come online",
    5000,
  );
  await waitFor(() => bridge.status().sync.fairlightConnected, "Fairlight connection", 5000);
  return bridge;
}

describe("full-stack endurance with the real Ember+ client", () => {
  it("runs a mixed operation loop and rejects stale writes after a reconnect", { timeout: 60_000 }, async () => {
    const port = await freePort();
    let provider = new MockEmberProvider({ port, channelCount: 24, auxSendCount: 2, monitorCount: 4, logger });
    await provider.start();
    const backend = new VirtualMidiBackend();
    const surface = new VirtualMcuSurface(backend, [
      { role: "main", inputName: MAIN_PORT, outputName: MAIN_PORT },
      { role: "extender1", inputName: EXTENDER_PORT, outputName: EXTENDER_PORT },
    ]);
    const client = createClient(port);
    const bridge = await startBridge(enduranceConfig(port), backend, client);

    try {
      assert.equal(bridge.status().sync.mapping.bankStep, 8);
      assert.equal(stripChannel(bridge, "main", 0), 1);
      assert.equal(stripChannel(bridge, "main", 8), null);
      assert.equal(bridge.status().sync.mapping.master, "main:1");
      assert.equal(stripChannel(bridge, "extender1", 0), 9);
      assertSettled(bridge, "startup");

      let bankDirection: "left" | "right" = "right";
      let bankedChannel: number | null = null;

      for (let iteration = 0; iteration < 20; iteration += 1) {
        const bankChange = iteration === 3 || iteration === 7 || iteration === 11 || iteration === 15 || iteration === 19;
        let previousChannel: number | null = null;
        let previousLevel: number | null = null;

        if (bankChange) {
          previousChannel = stripChannel(bridge, "extender1", 6);
          previousLevel = previousChannel === null ? null : levelOf(client, previousChannel);
          const expectedOffset = bankDirection === "right" ? 8 : 0;
          const expectedFirst = bankDirection === "right" ? 17 : 9;
          surface.pressBank("main", bankDirection);
          await waitFor(
            () => bridge.status().sync.mapping.bankOffset === expectedOffset,
            `extender bank ${bankDirection}`,
            5000,
          );
          await waitFor(
            () => stripChannel(bridge, "extender1", 0) === expectedFirst,
            "fresh extender mapping after banking",
            5000,
          );
          bankedChannel = stripChannel(bridge, "extender1", 0);
          bankDirection = bankDirection === "right" ? "left" : "right";
        }

        // 1. Touch, move, confirm, release, motor alignment.
        const faderStrip = iteration % 8;
        const faderChannel = stripChannel(bridge, "extender1", faderStrip);
        assert.notEqual(faderChannel, null, `iteration ${iteration}: extender strip ${faderStrip} maps to a channel`);
        if (faderChannel === null) throw new Error("unreachable");
        const targetDb = LEVEL_TARGETS[iteration % LEVEL_TARGETS.length]!;
        const confirmedDb = faderTargetDb(targetDb);
        surface.touch("extender1", faderStrip, true);
        surface.moveFader("extender1", faderStrip, targetDb);
        await waitFor(
          () => near(levelOf(client, faderChannel), confirmedDb),
          `iteration ${iteration}: fader write to channel ${faderChannel}`,
          5000,
        );
        await waitSettled(bridge, `iteration ${iteration}: fader write settled`);
        assertSettled(bridge, `iteration ${iteration}: fader`);
        surface.touch("extender1", faderStrip, false);
        await waitFor(
          () => surface.lastMotorRaw("extender1", faderStrip) === motorRawFor(confirmedDb),
          `iteration ${iteration}: motor aligned after release`,
          5000,
        );
        if (previousChannel !== null && previousLevel !== null) {
          assert.ok(
            near(levelOf(client, previousChannel), previousLevel),
            `iteration ${iteration}: previous bank channel ${previousChannel} must not change`,
          );
        }
        if (bankChange && bankedChannel !== null) {
          assert.equal(stripChannel(bridge, "extender1", 0), bankedChannel);
        }

        // 2. Mute through the surface, LED follows the confirmed value.
        const muteStrip = (iteration + 2) % 8;
        const muteChannel = stripChannel(bridge, "extender1", muteStrip);
        assert.notEqual(muteChannel, null, `iteration ${iteration}: mute strip maps to a channel`);
        if (muteChannel === null) throw new Error("unreachable");
        const mutedBefore = mutedOf(client, muteChannel) ?? false;
        surface.pressMute("extender1", muteStrip);
        await waitFor(
          () => mutedOf(client, muteChannel) === !mutedBefore,
          `iteration ${iteration}: mute write to channel ${muteChannel}`,
          5000,
        );
        await waitFor(
          () => surface.muteLed("extender1", muteStrip) === !mutedBefore,
          `iteration ${iteration}: mute LED follows channel ${muteChannel}`,
          5000,
        );
        await waitSettled(bridge, `iteration ${iteration}: mute settled`);
        assertSettled(bridge, `iteration ${iteration}: mute`);

        // 3. Provider pushes levels, mutes and pan; the untouched surface follows.
        const pushLevel = PUSH_LEVELS[iteration % PUSH_LEVELS.length]!;
        const pushPan = PUSH_PANS[iteration % PUSH_PANS.length]!;
        const pushMuted = iteration % 2 === 0;
        provider.updateChannel(faderChannel, { levelDb: pushLevel, muted: pushMuted, pan: pushPan });
        await waitFor(
          () => near(levelOf(client, faderChannel), pushLevel),
          `iteration ${iteration}: pushed level on channel ${faderChannel}`,
          5000,
        );
        await waitFor(
          () => mutedOf(client, faderChannel) === pushMuted,
          `iteration ${iteration}: pushed mute on channel ${faderChannel}`,
          5000,
        );
        await waitFor(
          () => panOf(client, faderChannel) === pushPan,
          `iteration ${iteration}: pushed pan on channel ${faderChannel}`,
          5000,
        );
        await waitSettled(bridge, `iteration ${iteration}: provider push settled`);
        await waitFor(
          () => surface.lastMotorRaw("extender1", faderStrip) === motorRawFor(pushLevel),
          `iteration ${iteration}: motor follows the provider push`,
          5000,
        );
        await waitFor(
          () => surface.muteLed("extender1", faderStrip) === pushMuted,
          `iteration ${iteration}: LED follows the provider push`,
          5000,
        );
        await waitFor(
          () => surface.panRing("extender1", faderStrip) === ringOf(pushPan),
          `iteration ${iteration}: ring follows the provider push`,
          5000,
        );
        assertSettled(bridge, `iteration ${iteration}: provider push`);

        // 4. A provider change while the fader is touched must not move the motor.
        if (iteration % 5 === 4) {
          const touchedStrip = (faderStrip + 1) % 8;
          const touchedChannel = stripChannel(bridge, "extender1", touchedStrip);
          assert.notEqual(touchedChannel, null, `iteration ${iteration}: touched strip maps to a channel`);
          if (touchedChannel === null) throw new Error("unreachable");
          const touchedLevel = -48 - (iteration % 3);
          surface.touch("extender1", touchedStrip, true);
          const motorsBefore = surface.motorMessages("extender1", touchedStrip).length;
          provider.updateChannel(touchedChannel, { levelDb: touchedLevel });
          await waitFor(
            () => near(levelOf(client, touchedChannel), touchedLevel),
            `iteration ${iteration}: pushed level on touched channel ${touchedChannel}`,
            5000,
          );
          await delay(150);
          assert.equal(
            surface.motorMessages("extender1", touchedStrip).length,
            motorsBefore,
            `iteration ${iteration}: touched motor stays still during a provider change`,
          );
          surface.touch("extender1", touchedStrip, false);
          await waitFor(
            () => surface.lastMotorRaw("extender1", touchedStrip) === motorRawFor(touchedLevel),
            `iteration ${iteration}: motor aligns after the touched push`,
            5000,
          );
          await waitSettled(bridge, `iteration ${iteration}: touched push settled`);
          assertSettled(bridge, `iteration ${iteration}: touched push`);
        }

        assert.equal(bridge.status().sync.pendingWrites, 0);
        assert.equal(bridge.status().sync.inFlight, null);
        assert.equal(bridge.status().sync.fairlightConnected, true);
      }

      // Fault: keep a write in flight, drop the provider, then adopt a fresh provider value.
      const freshWrites: Array<{ identifier: string; value: unknown }> = [];
      const staleDb = -6;
      provider.setValueDelayMs(1500);
      surface.touch("main", 0, true);
      surface.clearSent("main");
      surface.moveFader("main", 0, staleDb);
      await waitFor(
        () => bridge.status().sync.inFlight === "main:0:level",
        "delayed fader write to be in flight",
        5000,
      );
      provider.disconnectClients();
      await waitFor(
        () => bridge.status().sync.fairlightConnected === false,
        "Fairlight disconnect during an in-flight write",
        5000,
      );
      assert.equal(bridge.status().sync.pendingWrites, 0);
      await provider.stop();

      provider = new MockEmberProvider({
        port,
        channelCount: 24,
        auxSendCount: 2,
        monitorCount: 4,
        logger,
        onValueWritten: (identifier, value) => freshWrites.push({ identifier, value }),
      });
      await provider.start();
      provider.updateChannel(1, { levelDb: -30 });
      await waitFor(
        () => bridge.status().sync.fairlightConnected,
        "bridge reconnect after the provider restart",
        15_000,
      );
      await waitFor(() => near(levelOf(client, 1), -30), "fresh provider value adopted", 5000);
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === motorRawFor(-30),
        "motor aligns to the fresh provider value",
        5000,
      );
      await waitSettled(bridge, "writes settled after the reconnect");
      await delay(300);
      assert.deepEqual(
        freshWrites.filter((write) => write.identifier === "level").map((write) => write.value),
        [],
        "no stale fader value may be written after the reconnect",
      );
      assert.ok(near(levelOf(client, 1), -30), "fresh provider value is still in place");
      assertSettled(bridge, "after reconnect");

      // Normal writes recover after the fault.
      const recoveryDb = faderTargetDb(-18);
      surface.clearSent("main");
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -18);
      await waitFor(() => near(levelOf(client, 1), recoveryDb), "fader write after reconnect", 5000);
      surface.touch("main", 0, false);
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === motorRawFor(recoveryDb),
        "motor after the post-reconnect write",
        5000,
      );
      await waitSettled(bridge, "post-reconnect write settled");
      assertSettled(bridge, "post-reconnect write");
    } finally {
      await bridge.stop();
      await provider.stop();
    }
  });

  it("quarantines duplicate extenders end to end while main keeps working", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 24, auxSendCount: 2, monitorCount: 4, logger });
    await provider.start();
    const backend = new VirtualMidiBackend();
    const surface = new VirtualMcuSurface(backend, [
      { role: "main", inputName: MAIN_PORT, outputName: MAIN_PORT },
    ]);
    backend.addDevice({
      inputName: EXTENDER_DUP_PORT,
      outputName: EXTENDER_DUP_OUT_1,
      allowDuplicateNames: true,
    });
    backend.addDevice({
      inputName: EXTENDER_DUP_PORT,
      outputName: EXTENDER_DUP_OUT_2,
      allowDuplicateNames: true,
    });
    const client = createClient(port);
    const bridge = await startBridge(duplicateConfig(port), backend, client);

    try {
      for (const role of ["main", "extender1", "extender2"]) {
        const status = bridge.status().devices.find((device) => device.role === role);
        assert.equal(status?.online, true, `${role} online`);
        assert.equal(status?.quarantined, false, `${role} not quarantined`);
      }
      assert.equal(stripChannel(bridge, "extender1", 0), 9);
      assert.equal(stripChannel(bridge, "extender2", 0), 17);

      backend.removeDeviceAt(1);
      await waitFor(
        () =>
          bridge.status().devices
            .filter((device) => device.role === "extender1" || device.role === "extender2")
            .every((device) => !device.online && device.quarantined),
        "both duplicate extenders to be quarantined",
        5000,
      );
      for (const role of ["extender1", "extender2"]) {
        const status = bridge.status().devices.find((device) => device.role === role);
        assert.equal(status?.online, false, `${role} offline`);
        assert.equal(status?.quarantined, true, `${role} quarantined`);
        assert.match(status?.reason ?? "", /duplicate port name/);
      }
      const mainStatus = bridge.status().devices.find((device) => device.role === "main");
      assert.equal(mainStatus?.online, true);
      assert.equal(mainStatus?.quarantined, false);
      assertSettled(bridge, "after quarantine");

      const out1Before = backend.sentMessages(EXTENDER_DUP_OUT_1).length;
      const out2Before = backend.sentMessages(EXTENDER_DUP_OUT_2).length;
      const channel9Before = levelOf(client, 9);
      const channel17Before = levelOf(client, 17);

      // The remaining duplicate is still present in the virtual backend, but its role
      // is offline and quarantined, so injected gestures must not reach Fairlight or MIDI.
      backend.injectInput(EXTENDER_DUP_PORT, [MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE, 0x7f]);
      backend.injectInput(EXTENDER_DUP_PORT, encodeFader(0, DEFAULT_FADER_LAW.dbToRaw(-20)));
      backend.injectInput(EXTENDER_DUP_PORT, [MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE, 0x00]);
      await delay(250);

      assert.equal(backend.sentMessages(EXTENDER_DUP_OUT_1).length, out1Before);
      assert.equal(backend.sentMessages(EXTENDER_DUP_OUT_2).length, out2Before);
      assert.equal(levelOf(client, 9), channel9Before);
      assert.equal(levelOf(client, 17), channel17Before);
      assertSettled(bridge, "after extender gestures");

      const mainDb = faderTargetDb(-21);
      surface.clearSent("main");
      surface.touch("main", 0, true);
      surface.moveFader("main", 0, -21);
      await waitFor(() => near(levelOf(client, 1), mainDb), "main fader after quarantine", 5000);
      await waitSettled(bridge, "main write after quarantine settled");
      surface.touch("main", 0, false);
      await waitFor(
        () => surface.lastMotorRaw("main", 0) === motorRawFor(mainDb),
        "main motor after quarantine",
        5000,
      );
      assertSettled(bridge, "main after quarantine");
    } finally {
      await bridge.stop();
      await provider.stop();
    }
  });
});
