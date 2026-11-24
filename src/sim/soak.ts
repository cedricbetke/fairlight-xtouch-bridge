import { createServer } from "node:net";

import { parseConfig, type BridgeConfig, type SurfaceRole } from "../config.js";
import { EmberFairlightClient } from "../fairlight/emberClient.js";
import { MockEmberProvider } from "../fairlight/mockProvider.js";
import type { Logger } from "../logger.js";
import { DEFAULT_FADER_LAW } from "../mcu/faderLaw.js";
import { VirtualMidiBackend } from "../midi/virtualBackend.js";
import { Bridge } from "../runtime/bridge.js";
import { VirtualMcuSurface } from "./virtualSurface.js";

const MAIN: SurfaceRole = "main";
const EXTENDER: SurfaceRole = "extender1";
const MAIN_PORT = "Soak X-Touch Main";
const EXTENDER_PORT = "Soak X-Touch Extender";

const STATUS_INTERVAL_MS = 10_000;
const PENDING_STUCK_MS = 5000;
const IN_FLIGHT_STUCK_MS = 5000;

const FADER_TARGETS = [-40, -30, -20, -10, -5, 0, -15, -25] as const;

export interface SoakOptions {
  seconds: number;
  channels?: number;
  logger: Logger;
  report?: (line: string) => void;
  /** Stops the soak at the next safe point, for Ctrl+C. */
  signal?: AbortSignal;
}

export interface SoakResult {
  ok: boolean;
  summary: string;
}

interface WriteObservation {
  at: number;
  generation: number;
  identifier: string;
  value: unknown;
}

class SoakFailure extends Error {}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a soak port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function rssMb(): number {
  return process.memoryUsage().rss / 1_048_576;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  signal?: AbortSignal,
  onPoll?: () => void,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    if (predicate()) return true;
    onPoll?.();
    await sleep(25, signal);
  }
  return predicate();
}

function soakConfig(port: number, channels: number): BridgeConfig {
  return parseConfig({
    fairlight: { host: "127.0.0.1", port, requestTimeoutMs: 2000 },
    midi: {
      rescanIntervalMs: 250,
      devices: [
        {
          role: MAIN,
          kind: "main",
          input: { name: MAIN_PORT, occurrence: 0 },
          output: { name: MAIN_PORT, occurrence: 0 },
          encoder: "pan",
          meters: true,
        },
        {
          role: EXTENDER,
          kind: "extender",
          input: { name: EXTENDER_PORT, occurrence: 0 },
          output: { name: EXTENDER_PORT, occurrence: 0 },
          encoder: "pan",
          meters: true,
        },
      ],
    },
    mapping: {
      bankStep: 8,
      master: { enabled: true, busType: "main", busIndex: 1 },
      layout: {
        order: [MAIN, EXTENDER],
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
      allowedWriteChannels: Array.from({ length: Math.max(1, channels) }, (_, index) => index + 1),
      allowedWriteBuses: ["main:1"],
      maxWritesPerSecond: 30,
      writeExpiryMs: 1000,
    },
    logLevel: "error",
  });
}

/**
 * Hardware-free endurance run over the same TCP path as production:
 * in-process Ember+ provider, real Ember+ client, bridge and virtual MIDI surfaces.
 */
export async function runSoak(options: SoakOptions): Promise<SoakResult> {
  const report = options.report ?? ((line: string) => process.stdout.write(line + "\n"));
  const signal = options.signal;
  const seconds = Math.max(0, options.seconds);
  const channels = options.channels ?? 24;
  const startRss = rssMb();
  let peakRss = startRss;
  const startAt = Date.now();
  const deadline = startAt + seconds * 1000;

  const port = await freePort();
  const config = soakConfig(port, channels);
  const backend = new VirtualMidiBackend();
  const surface = new VirtualMcuSurface(backend, [
    { role: MAIN, inputName: MAIN_PORT, outputName: MAIN_PORT },
    { role: EXTENDER, inputName: EXTENDER_PORT, outputName: EXTENDER_PORT },
  ]);

  const writes: WriteObservation[] = [];
  let providerGeneration = 0;
  let quietGeneration: number | null = null;
  let quietViolation: string | null = null;
  let offlineBaseline: { role: SurfaceRole; count: number } | null = null;
  const unexpectedSends: string[] = [];

  const recordWrite = (generation: number, identifier: string, value: unknown): void => {
    writes.push({ at: Date.now(), generation, identifier, value });
    if (quietGeneration === generation) {
      quietViolation = `stale write after reconnect (${identifier}=${String(value)})`;
    }
  };

  const makeProvider = (generation: number): MockEmberProvider =>
    new MockEmberProvider({
      port,
      channelCount: channels,
      auxSendCount: 2,
      monitorCount: 4,
      logger: options.logger,
      onValueWritten: (identifier, value) => recordWrite(generation, identifier, value),
    });

  let provider = makeProvider(providerGeneration);
  const client = new EmberFairlightClient({
    host: "127.0.0.1",
    port,
    requestTimeoutMs: 2000,
    reconnectAttempts: 0,
    autoReconnect: true,
    logger: options.logger,
    subscribeMeters: true,
    watchChannelNames: [],
    watchAuxSends: [],
    watchMonitors: [],
  });
  const bridge = new Bridge({
    config,
    arming: { writes: true, motors: true },
    backend,
    logger: options.logger,
    fairlight: client,
  });

  let connectedEvents = 0;
  const unsubscribe = client.onEvent((event) => {
    if (event.type === "connected") connectedEvents += 1;
  });

  for (const [role, outputName] of [
    [MAIN, MAIN_PORT],
    [EXTENDER, EXTENDER_PORT],
  ] as const) {
    backend.onOutput(outputName, () => {
      const status = bridge.status().devices.find((device) => device.role === role);
      if (!status || !status.online || status.quarantined) {
        unexpectedSends.push(`${role}:${status?.quarantined ? "quarantined" : "offline"}`);
      }
    });
  }

  const random = createRandom(0x5eed);
  const state = {
    operations: 0,
    pendingSince: 0,
    inFlightSince: 0,
    lastInFlight: null as string | null,
  };
  let lastReportAt = startAt;
  let reportTimer: NodeJS.Timeout | undefined;
  let failure: string | null = null;

  const updateRss = (): void => {
    peakRss = Math.max(peakRss, rssMb());
  };

  const maybeReport = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastReportAt < STATUS_INTERVAL_MS) return;
    lastReportAt = now;
    updateRss();
    const sync = bridge.status().sync;
    report(
      `[soak] elapsed=${((now - startAt) / 1000).toFixed(1)}s operations=${state.operations} writes=${writes.length} reconnects=${Math.max(0, connectedEvents - 1)} pending=${sync.pendingWrites} inFlight=${sync.inFlight ?? "-"} rss=${rssMb().toFixed(1)}MB`,
    );
  };

  const checkSyncInvariants = (): void => {
    if (quietViolation !== null) throw new SoakFailure(quietViolation);
    if (unexpectedSends.length > 0) {
      throw new SoakFailure(`unexpected MIDI output while a role was offline or quarantined (${unexpectedSends[0]})`);
    }
    const sync = bridge.status().sync;
    const now = Date.now();
    if (sync.pendingWrites > 0) {
      if (state.pendingSince === 0) state.pendingSince = now;
      else if (now - state.pendingSince > PENDING_STUCK_MS) {
        throw new SoakFailure(`pending writes stuck for ${Math.round(now - state.pendingSince)} ms`);
      }
    } else {
      state.pendingSince = 0;
    }
    if (sync.inFlight !== null) {
      if (state.inFlightSince === 0 || state.lastInFlight !== sync.inFlight) {
        state.lastInFlight = sync.inFlight;
        state.inFlightSince = now;
      } else if (now - state.inFlightSince > IN_FLIGHT_STUCK_MS) {
        throw new SoakFailure(
          `write ${sync.inFlight} stuck in flight for ${Math.round(now - state.inFlightSince)} ms`,
        );
      }
    } else {
      state.lastInFlight = null;
      state.inFlightSince = 0;
    }
    if (offlineBaseline !== null && surface.sentMessages(offlineBaseline.role).length > offlineBaseline.count) {
      throw new SoakFailure(`MIDI output while role ${offlineBaseline.role} was offline`);
    }
  };

  const checkInvariants = (): void => {
    updateRss();
    checkSyncInvariants();
  };

  const roleOnline = (role: SurfaceRole): boolean =>
    bridge.status().devices.find((device) => device.role === role)?.online === true;

  const pickRole = (): SurfaceRole => (roleOnline(EXTENDER) && random() < 0.5 ? EXTENDER : MAIN);

  const stripChannel = (role: SurfaceRole, strip: number): number | null => {
    const target = bridge
      .status()
      .sync.mapping.strips.find((entry) => entry.role === role && entry.strip === strip)?.target;
    if (!target?.startsWith("channel:")) return null;
    const channel = Number(target.slice("channel:".length));
    return Number.isInteger(channel) ? channel : null;
  };

  const pickStrip = (role: SurfaceRole): number | null => {
    const start = Math.floor(random() * 8);
    for (let offset = 0; offset < 8; offset += 1) {
      const strip = (start + offset) % 8;
      if (stripChannel(role, strip) !== null) return strip;
    }
    return null;
  };

  const doFader = (): void => {
    const role = pickRole();
    const strip = pickStrip(role);
    if (strip === null) return;
    const target = FADER_TARGETS[Math.floor(random() * FADER_TARGETS.length)]!;
    surface.touch(role, strip, true);
    surface.moveFader(role, strip, target);
    surface.touch(role, strip, false);
  };

  const doMute = (): void => {
    const role = pickRole();
    const strip = pickStrip(role);
    if (strip === null) return;
    surface.pressMute(role, strip);
  };

  const doPan = (): void => {
    const role = pickRole();
    const strip = pickStrip(role);
    if (strip === null) return;
    const magnitude = 1 + Math.floor(random() * 3);
    surface.turnEncoder(role, strip, random() < 0.5 ? -magnitude : magnitude);
  };

  const doBank = (): void => {
    surface.pressBank(MAIN, random() < 0.5 ? "left" : "right");
  };

  const doProviderPush = (): void => {
    const channel = 1 + Math.floor(random() * channels);
    const kind = Math.floor(random() * 3);
    if (kind === 0) {
      provider.updateChannel(channel, { levelDb: -50 + random() * 55 });
    } else if (kind === 1) {
      provider.updateChannel(channel, { muted: random() < 0.5 });
    } else {
      provider.updateChannel(channel, { pan: -100 + random() * 200 });
    }
  };

  const waitOrFail = async (
    predicate: () => boolean,
    description: string,
    timeoutMs: number,
  ): Promise<void> => {
    const ok = await waitFor(predicate, timeoutMs, signal, checkInvariants);
    if (signal?.aborted) return;
    if (!ok) throw new SoakFailure(`timed out waiting for ${description}`);
  };

  const restartProvider = async (): Promise<void> => {
    provider.disconnectClients();
    await waitOrFail(() => !bridge.status().sync.fairlightConnected, "provider disconnect", 5000);
    if (signal?.aborted) return;
    await provider.stop();
    providerGeneration += 1;
    const generation = providerGeneration;
    quietGeneration = generation;
    const fresh = makeProvider(generation);
    await fresh.start();
    provider = fresh;
    fresh.updateChannel(1, { levelDb: -42 });
    await waitOrFail(
      () => bridge.status().sync.fairlightConnected,
      "reconnect after a provider restart",
      16_000,
    );
    if (signal?.aborted) return;
    await sleep(250, signal);
    const settled = await waitFor(
      () => {
        const sync = bridge.status().sync;
        return sync.pendingWrites === 0 && sync.inFlight === null;
      },
      5000,
      signal,
      checkInvariants,
    );
    if (!signal?.aborted && !settled) {
      throw new SoakFailure("pending or in-flight write survived the reconnect");
    }
    quietGeneration = null;
  };

  const unplugReplug = async (): Promise<void> => {
    if (!roleOnline(EXTENDER)) return;
    surface.remove(EXTENDER);
    await waitOrFail(() => !roleOnline(EXTENDER), "extender offline", 5000);
    if (signal?.aborted) return;
    const baseline = surface.sentMessages(EXTENDER).length;
    offlineBaseline = { role: EXTENDER, count: baseline };
    await sleep(150 + Math.floor(random() * 250), signal);
    if (!signal?.aborted && surface.sentMessages(EXTENDER).length !== baseline) {
      throw new SoakFailure("MIDI output while the extender role was offline");
    }
    offlineBaseline = null;
    surface.restore(EXTENDER);
    await waitOrFail(() => roleOnline(EXTENDER), "extender online", 5000);
  };

  const restartEveryMs = Math.min(30_000, Math.max(2_000, Math.floor((seconds * 1000) / 4)));
  const unplugEveryMs = Math.min(20_000, Math.max(3_000, Math.floor((seconds * 1000) / 3)));
  let nextRestartAt = startAt + restartEveryMs;
  let nextUnplugAt = startAt + unplugEveryMs;

  const performOperation = async (): Promise<void> => {
    const now = Date.now();
    if (now >= nextRestartAt) {
      nextRestartAt = now + restartEveryMs;
      await restartProvider();
      return;
    }
    if (now >= nextUnplugAt) {
      nextUnplugAt = now + unplugEveryMs;
      await unplugReplug();
      return;
    }
    const roll = random();
    if (roll < 0.34) doFader();
    else if (roll < 0.5) doMute();
    else if (roll < 0.62) doBank();
    else if (roll < 0.78) doPan();
    else if (roll < 0.9) doProviderPush();
    else doFader();
  };

  try {
    await provider.start();
    await bridge.start();
    await waitOrFail(
      () => bridge.status().devices.every((device) => device.online),
      "virtual MIDI devices to come online",
      5000,
    );
    await waitOrFail(() => bridge.status().sync.fairlightConnected, "Fairlight connection", 5000);

    report(
      "Soak start: in-process mock Fairlight Ember+ provider and virtual X-Touch surfaces; no real MIDI ports or Fairlight are touched.",
    );
    reportTimer = setInterval(() => {
      try {
        maybeReport();
      } catch {}
    }, 1000);
    reportTimer.unref();

    while (Date.now() < deadline && !signal?.aborted) {
      checkInvariants();
      maybeReport();
      await performOperation();
      state.operations += 1;
      await sleep(40 + Math.floor(random() * 70), signal);
    }

    if (!signal?.aborted) {
      const settled = await waitFor(
        () => {
          const sync = bridge.status().sync;
          return sync.pendingWrites === 0 && sync.inFlight === null;
        },
        5000,
        undefined,
        checkInvariants,
      );
      if (!settled) throw new SoakFailure("writes did not settle at the end of the soak");
    }
    checkSyncInvariants();
  } catch (error) {
    failure = error instanceof SoakFailure ? error.message : `unhandled exception: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  } finally {
    if (reportTimer) {
      clearInterval(reportTimer);
      reportTimer = undefined;
    }
    unsubscribe();
    try {
      await bridge.stop();
    } catch (error) {
      options.logger.warn("soak.bridge_stop_failed", { error });
    }
    try {
      await provider.stop();
    } catch (error) {
      options.logger.warn("soak.provider_stop_failed", { error });
    }
  }

  const endRss = rssMb();
  peakRss = Math.max(peakRss, endRss);
  const elapsed = (Date.now() - startAt) / 1000;
  const ok = failure === null;
  const summary = [
    ok ? "ok" : "failed",
    `elapsed=${elapsed.toFixed(1)}s`,
    `operations=${state.operations}`,
    `writes=${writes.length}`,
    `reconnects=${Math.max(0, connectedEvents - 1)}`,
    `rssStart=${startRss.toFixed(1)}MB`,
    `rssEnd=${endRss.toFixed(1)}MB`,
    `rssPeak=${peakRss.toFixed(1)}MB`,
    failure === null ? null : `failure="${failure}"`,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
  report(`Soak summary: ${summary}`);
  return { ok, summary };
}
