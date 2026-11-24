import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:net";

import { parseConfig } from "../src/config.js";
import { EmberFairlightClient } from "../src/fairlight/emberClient.js";
import { MockEmberProvider } from "../src/fairlight/mockProvider.js";
import { createLogger } from "../src/logger.js";
import { DEFAULT_FADER_LAW } from "../src/mcu/faderLaw.js";
import {
  MCU_NOTE_TOUCH_BASE,
  MCU_STATUS_NOTE_ON,
  decodeMcuMessage,
  encodeFader,
} from "../src/mcu/codec.js";
import { MockRtpMidiPeer } from "../src/midi/mockRtpMidiPeer.js";
import { RtpMidiSession } from "../src/midi/rtpMidiSession.js";
import { VirtualMidiBackend } from "../src/midi/virtualBackend.js";
import { Bridge } from "../src/runtime/bridge.js";
import { VirtualMcuSurface, waitFor } from "../src/sim/virtualSurface.js";

const logger = createLogger("error", { sink: () => undefined });
const MAIN_PORT = "Network Endurance Main";

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

async function startPeer(): Promise<MockRtpMidiPeer> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await freePort();
    const peer = new MockRtpMidiPeer({ port, logger });
    try {
      await peer.start();
      return peer;
    } catch {
      await peer.stop().catch(() => undefined);
    }
  }
  throw new Error("Could not bind a mock RTP-MIDI peer");
}

function near(actual: number | null | undefined, expected: number, epsilon = 0.06): boolean {
  return actual !== null && actual !== undefined && Math.abs(actual - expected) <= epsilon;
}

function motorRawFor(db: number): number {
  return DEFAULT_FADER_LAW.dbToRaw(Number(db.toFixed(1)));
}

function stripChannel(bridge: Bridge, role: string, strip: number): number | null {
  const target = bridge
    .status()
    .sync.mapping.strips.find((entry) => entry.role === role && entry.strip === strip)?.target;
  if (!target?.startsWith("channel:")) return null;
  const channel = Number(target.slice("channel:".length));
  return Number.isInteger(channel) ? channel : null;
}

describe("mixed USB and RTP-MIDI surfaces", () => {
  it("runs two network extenders through the bridge and survives one of them reconnecting", { timeout: 60_000 }, async () => {
    const providerPort = await freePort();
    const provider = new MockEmberProvider({
      port: providerPort,
      channelCount: 40,
      auxSendCount: 2,
      monitorCount: 4,
      logger,
    });
    await provider.start();

    const extender1 = await startPeer();
    const extender1Port = extender1.port;
    const extender2 = await startPeer();
    const extender2Messages: number[][] = [];
    const extender1Messages: number[][] = [];
    extender1.onEvent((event) => {
      if (event.type === "midi") extender1Messages.push(event.message);
    });
    extender2.onEvent((event) => {
      if (event.type === "midi") extender2Messages.push(event.message);
    });

    const config = parseConfig({
      fairlight: { host: "127.0.0.1", port: providerPort, requestTimeoutMs: 2000 },
      midi: {
        rescanIntervalMs: 250,
        devices: [
          {
            role: "main",
            kind: "main",
            input: { name: MAIN_PORT, occurrence: 0 },
            output: { name: MAIN_PORT, occurrence: 0 },
          },
          {
            role: "extender1",
            kind: "extender",
            transport: "network",
            network: { host: "127.0.0.1", port: extender1.port },
          },
          {
            role: "extender2",
            kind: "extender",
            transport: "network",
            network: { host: "127.0.0.1", port: extender2.port },
          },
        ],
      },
      mapping: {
        bankStep: 8,
        master: { enabled: true, busType: "main", busIndex: 1 },
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
        allowedWriteChannels: Array.from({ length: 40 }, (_, index) => index + 1),
        allowedWriteBuses: ["main:1"],
        maxWritesPerSecond: 50,
        writeExpiryMs: 2000,
      },
      logLevel: "error",
    });

    const backend = new VirtualMidiBackend();
    const surface = new VirtualMcuSurface(backend, [
      { role: "main", inputName: MAIN_PORT, outputName: MAIN_PORT },
    ]);
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port: providerPort,
      requestTimeoutMs: 2000,
      reconnectAttempts: 0,
      autoReconnect: true,
      logger,
      subscribeMeters: true,
      watchChannelNames: [],
      watchAuxSends: [],
      watchMonitors: [],
    });
    const bridge = new Bridge({
      config,
      arming: { writes: true, motors: true },
      backend,
      logger,
      fairlight: client,
      midi: {
        createRtpMidiSession: (device) =>
          new RtpMidiSession({
            host: device.network?.host ?? "",
            port: device.network?.port ?? 0,
            name: device.name ?? `Bridge ${device.role}`,
            logger,
            inviteIntervalMs: 100,
            inviteAttempts: 6,
            retryDelayMs: 200,
            sessionTimeoutMs: 1500,
            syncIntervalMs: 300,
            tickMs: 20,
          }),
      },
    });

    const levelOf = (index: number): number | null =>
      client.snapshot().channels.find((channel) => channel.index === index)?.levelDb ?? null;

    try {
      await bridge.start();
      await waitFor(
        () => bridge.status().devices.every((device) => device.online),
        "all three surfaces online",
        8000,
      );
      await waitFor(() => bridge.status().sync.fairlightConnected, "Fairlight connection", 5000);

      assert.equal(stripChannel(bridge, "extender1", 0), 9);
      assert.equal(stripChannel(bridge, "extender2", 0), 17);
      await waitFor(
        () => extender1Messages.some((message) => message[0] === 0xf0 && message[3] === 0x66),
        "LCD SysEx on the first RTP-MIDI extender",
        3000,
      );

      const levelBefore = levelOf(17);
      extender1.send([MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE, 0x7f]);
      extender1.send(encodeFader(0, DEFAULT_FADER_LAW.dbToRaw(-20)));
      await waitFor(() => near(levelOf(9), -20), "fader write through RTP-MIDI", 5000);
      extender1.send([MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE, 0x00]);

      await waitFor(
        () =>
          extender1Messages.some((message) => {
            const decoded = decodeMcuMessage(message);
            return decoded?.type === "fader" && decoded.strip === 0 && decoded.raw === motorRawFor(-20);
          }),
        "motor feedback over RTP-MIDI",
        5000,
      );
      assert.equal(levelOf(17), levelBefore, "the other network extender must not change");

      surface.pressBank("main", "right");
      await waitFor(() => stripChannel(bridge, "extender1", 0) === 25, "banked mapping", 5000);
      assert.equal(stripChannel(bridge, "extender2", 0), 33);

      await extender1.stop();
      await waitFor(
        () =>
          bridge.status().devices.find((device) => device.role === "extender1")?.online === false,
        "first extender offline",
        5000,
      );
      assert.equal(
        bridge.status().devices.find((device) => device.role === "extender2")?.online,
        true,
        "the second extender keeps its session",
      );
      assert.equal(stripChannel(bridge, "extender2", 0), 33, "mapping of the second extender stays");

      extender2.send([MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE + 1, 0x7f]);
      extender2.send(encodeFader(1, DEFAULT_FADER_LAW.dbToRaw(-14)));
      await waitFor(() => near(levelOf(34), -14), "fader write on the remaining extender", 5000);
      extender2.send([MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE + 1, 0x00]);

      const restarted = new MockRtpMidiPeer({ port: extender1Port, logger });
      await restarted.start();
      try {
        await waitFor(
          () =>
            bridge.status().devices.find((device) => device.role === "extender1")?.online === true,
          "first extender reconnects",
          8000,
        );
        assert.equal(stripChannel(bridge, "extender1", 0), 25, "reconnected extender keeps its bank");
        restarted.send([MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE + 2, 0x7f]);
        restarted.send(encodeFader(2, DEFAULT_FADER_LAW.dbToRaw(-11)));
        await waitFor(() => near(levelOf(27), -11), "fader write after reconnect", 5000);
        restarted.send([MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE + 2, 0x00]);
      } finally {
        await restarted.stop();
      }

      const sync = bridge.status().sync;
      assert.equal(sync.pendingWrites, 0);
      assert.equal(sync.inFlight, null);
      assert.equal(sync.fairlightConnected, true);
    } finally {
      await bridge.stop();
      await extender1.stop();
      await extender2.stop();
      await provider.stop();
    }
  });
});
