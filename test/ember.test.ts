import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:net";

import { EmberFairlightClient } from "../src/fairlight/emberClient.js";
import { MockEmberProvider } from "../src/fairlight/mockProvider.js";
import type { ChannelState, FairlightEvent } from "../src/fairlight/types.js";
import { FairlightError } from "../src/errors.js";
import { createLogger } from "../src/logger.js";

const logger = createLogger("error", { sink: () => undefined });

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

async function waitFor(predicate: () => boolean, description: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe("Ember+ Fairlight client", () => {
  it("discovers a provider, writes values and receives pushed updates", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 24, logger });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
      watchChannelNames: [1],
    });
    const events: FairlightEvent[] = [];
    client.onEvent((event) => events.push(event));
    try {
      await client.connect();
      const snapshot = client.snapshot();
      assert.equal(snapshot.channels.length, 24);
      assert.equal(snapshot.channels[0]?.name, "CH 01");
      assert.equal(snapshot.channels[0]?.levelDb, -12);
      assert.equal(snapshot.channels[0]?.muted, false);
      assert.equal(snapshot.channels[0]?.writableLevel, true);
      assert.equal(snapshot.channels[0]?.writableMute, true);
      assert.equal(snapshot.buses.filter((bus) => bus.type === "main").length, 2);
      assert.equal(snapshot.buses.filter((bus) => bus.type === "aux").length, 2);
      assert.equal(snapshot.buses.filter((bus) => bus.type === "vca").length, 2);
      assert.ok(events.some((event) => event.type === "connected"));

      const confirmedLevel = await client.setChannelLevel(1, -6);
      assert.equal(confirmedLevel, -6);
      assert.equal(client.snapshot().channels[0]?.levelDb, -6);

      const confirmedMute = await client.setChannelMute(1, true);
      assert.equal(confirmedMute, true);
      assert.equal(client.snapshot().channels[0]?.muted, true);

      const confirmedBus = await client.setBusLevel("main", 1, -4);
      assert.equal(confirmedBus, -4);

      provider.updateChannel(1, { levelDb: -30 });
      await waitFor(() => client.snapshot().channels[0]?.levelDb === -30, "pushed channel level");
      provider.updateChannel(1, { muted: false });
      await waitFor(() => client.snapshot().channels[0]?.muted === false, "pushed channel mute");
      provider.updateChannel(1, { name: "RENAMED" });
      await waitFor(() => client.snapshot().channels[0]?.name === "RENAMED", "pushed channel name");

      const channelEvents = events.filter(
        (event): event is Extract<FairlightEvent, { type: "channel" }> => event.type === "channel",
      );
      const latest: ChannelState | undefined = channelEvents.at(-1)?.channel;
      assert.equal(latest?.index, 1);
      assert.equal(latest?.levelDb, -30);
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("discovers and writes an aux send level", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 2, auxSendCount: 2, logger });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
      watchAuxSends: [2],
    });
    try {
      await client.connect();
      const channel = client.snapshot().channels[0];
      assert.equal(channel?.sends["aux:2"]?.levelDb, -12);
      assert.equal(channel?.sends["aux:2"]?.writableLevel, true);
      assert.equal(channel?.sends["aux:1"], undefined);

      const confirmed = await client.setChannelSendLevel(1, 2, -7.5);
      assert.equal(confirmed, -7.5);
      assert.equal(client.snapshot().channels[0]?.sends["aux:2"]?.levelDb, -7.5);

      provider.updateChannelSend(1, 2, { levelDb: -3 });
      await waitFor(
        () => client.snapshot().channels[0]?.sends["aux:2"]?.levelDb === -3,
        "pushed aux send level",
      );
      await assert.rejects(() => client.setChannelSendLevel(1, 1, -6));
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("discovers and writes monitor dim", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 2, monitorCount: 4, logger });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
      watchMonitors: [2],
    });
    const events: FairlightEvent[] = [];
    client.onEvent((event) => events.push(event));
    try {
      await client.connect();
      const monitors = client.snapshot().monitors;
      assert.equal(monitors.length, 4);
      assert.equal(monitors[1]?.index, 2);
      assert.equal(monitors[1]?.dimmed, false);
      assert.equal(monitors[1]?.writableDim, true);

      const confirmed = await client.setMonitorDim(2, true);
      assert.equal(confirmed, true);
      assert.equal(client.snapshot().monitors[1]?.dimmed, true);

      provider.updateMonitor(2, { dimmed: false });
      await waitFor(() => client.snapshot().monitors[1]?.dimmed === false, "pushed monitor dim");
      assert.ok(events.some((event) => event.type === "monitor" && event.monitor.index === 2));

      await assert.rejects(() => client.setMonitorDim(9, true));
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("accepts a level confirmation rounded to the provider resolution", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 24, logger, levelDecimals: 1 });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
    });
    try {
      await client.connect();
      const confirmed = await client.setChannelLevel(1, -19.42867606665446);
      assert.equal(confirmed, -19.4);
      assert.equal(client.snapshot().channels[0]?.levelDb, -19.4);
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("quantises level writes to the provider resolution before sending", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 24, logger, levelDecimals: 1 });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
    });
    try {
      await client.connect();
      const confirmed = await client.setChannelLevel(1, -29.15094915461148);
      assert.equal(confirmed, -29.2);
      assert.equal(client.snapshot().channels[0]?.levelDb, -29.2);
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("rejects a level confirmation outside the accepted tolerance", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 24, logger, levelDecimals: 0 });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
    });
    try {
      await client.connect();
      await assert.rejects(
        client.setChannelLevel(1, -19.42867606665446),
        (error: unknown) => error instanceof FairlightError && error.code === "WRITE_UNCONFIRMED",
      );
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("keeps push feedback and writes working after a structure refresh", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const provider = new MockEmberProvider({ port, channelCount: 24, logger });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 3000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
    });
    const events: FairlightEvent[] = [];
    client.onEvent((event) => events.push(event));
    try {
      await client.connect();
      provider.touchChannelRoot("Channels v2");
      await waitFor(
        () => events.some((event) => event.type === "structure-change-detected"),
        "structure detection",
      );
      await waitFor(
        () => events.some((event) => event.type === "structure-revalidated"),
        "structure revalidation",
        10_000,
      );

      provider.updateChannel(1, { levelDb: -40 });
      await waitFor(() => client.snapshot().channels[0]?.levelDb === -40, "push after refresh");
      const confirmed = await client.setChannelLevel(1, -5);
      assert.equal(confirmed, -5);
      assert.equal(client.snapshot().channels[0]?.levelDb, -5);
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });

  it("rejects a closed Ember+ port instead of hanging", { timeout: 20_000 }, async () => {
    const port = await freePort();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 1000,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
    });
    try {
      await assert.rejects(client.connect(), FairlightError);
      assert.equal(client.connected, false);
    } finally {
      await client.disconnect();
    }
  });

  it("reconnects with fresh subscriptions after a provider restart", { timeout: 30_000 }, async () => {
    const port = await freePort();
    let provider = new MockEmberProvider({ port, channelCount: 24, logger });
    await provider.start();
    const client = new EmberFairlightClient({
      host: "127.0.0.1",
      port,
      requestTimeoutMs: 2000,
      reconnectAttempts: -1,
      autoReconnect: true,
      logger,
    });
    const events: FairlightEvent[] = [];
    client.onEvent((event) => events.push(event));
    try {
      await client.connect();
      assert.equal(client.connected, true);

      await provider.stop();
      await waitFor(
        () => events.some((event) => event.type === "disconnected"),
        "disconnect event",
        5000,
      );

      provider = new MockEmberProvider({ port, channelCount: 24, logger });
      await provider.start();
      await waitFor(() => events.filter((event) => event.type === "connected").length >= 2, "reconnect", 15_000);

      provider.updateChannel(1, { levelDb: -35 });
      await waitFor(() => client.snapshot().channels[0]?.levelDb === -35, "push after reconnect");
    } finally {
      await client.disconnect();
      await provider.stop();
    }
  });
});
