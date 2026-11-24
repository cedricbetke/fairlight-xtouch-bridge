#!/usr/bin/env node
import { existsSync } from "node:fs";

import { configuredAuxTargets, configuredMonitorTargets, loadConfig, type BridgeConfig } from "./config.js";
import { BridgeError, ConfigError } from "./errors.js";
import { EmberFairlightClient } from "./fairlight/emberClient.js";
import { MockEmberProvider } from "./fairlight/mockProvider.js";
import type { FairlightClient, FairlightSnapshot } from "./fairlight/types.js";
import { createLogger, isLogLevel, type LogLevel } from "./logger.js";
import { MidiDeviceManager, resolvePort, type MidiPortsSnapshot } from "./midi/deviceManager.js";
import { EmptyMidiBackend } from "./midi/emptyBackend.js";
import { NativeMidiBackend } from "./midi/realBackend.js";
import { probeRtpMidi, RtpMidiSession } from "./midi/rtpMidiSession.js";
import { decodeMcuMessage } from "./mcu/codec.js";
import { buttonLabel, isButtonId } from "./mcu/buttons.js";
import { Bridge } from "./runtime/bridge.js";
import { runDoctor, type DoctorNetworkProbe, type DoctorReport } from "./runtime/doctor.js";
import { runSimulation } from "./sim/scenario.js";
import { runSoak } from "./sim/soak.js";
import { createDemoConfig } from "./settings/demo.js";
import { SettingsServer } from "./settings/server.js";

const VERSION = "0.1.1";

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "pretty",
  "arm",
  "arm-motor",
  "arm-writes",
  "demo",
  "no-discover",
  "skip-midi",
  "skip-fairlight",
]);

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (argument === "-h") {
      flags.set("help", true);
      continue;
    }
    if (argument === "-v") {
      flags.set("version", true);
      continue;
    }
    if (argument.startsWith("--")) {
      const withoutPrefix = argument.slice(2);
      const equals = withoutPrefix.indexOf("=");
      if (equals >= 0) {
        flags.set(withoutPrefix.slice(0, equals), withoutPrefix.slice(equals + 1));
        continue;
      }
      if (BOOLEAN_FLAGS.has(withoutPrefix)) {
        flags.set(withoutPrefix, true);
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new ConfigError(`Flag --${withoutPrefix} requires a value`);
      }
      flags.set(withoutPrefix, next);
      index += 1;
      continue;
    }
    positionals.push(argument);
  }
  return { positionals, flags };
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new ConfigError(`Flag --${name} requires a value`);
  return value;
}

function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`Flag --${name} must be a number`);
  return value;
}

function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function resolveLogLevel(args: ParsedArgs, config: BridgeConfig): LogLevel {
  const raw = flagString(args, "log-level");
  if (raw === undefined) return config.logLevel;
  if (!isLogLevel(raw)) throw new ConfigError("--log-level must be one of debug, info, warn, error");
  return raw;
}

function configPath(args: ParsedArgs): string {
  return flagString(args, "config") ?? "config/bridge.json";
}

function printHelp(): void {
  process.stdout.write(
    [
      "fairlight-xtouch-bridge " + VERSION,
      "",
      "Usage:",
      "  bridge run --config <file> [--arm-motor] [--arm-writes] [--pretty]",
      "  bridge discover [--config <file>] [--host <ip>] [--port <n>] [--json]",
      "  bridge doctor [--config <file>] [--host <ip>] [--port <n>] [--skip-midi] [--skip-fairlight] [--json]",
      "  bridge midi list [--config <file>]",
      "  bridge midi monitor [--config <file>] [--device main|extender1|extender2] [--duration <s>]",
      "  bridge simulate [--pretty]",
      "  bridge soak [--seconds <n>] [--minutes <n>] [--channels <n>] [--log-level <level>] [--pretty]",
      "  bridge mock-ember [--port <n>] [--channels <n>]",
      "  bridge settings [--config <file>] [--port <n>] [--demo] [--no-discover]",
      "  bridge config validate --config <file>",
      "",
      "Write and motor output are disabled unless explicitly armed.",
      "Fairlight must have Ember+ enabled under File > Show Settings > Ember+.",
      "soak is hardware-free: it uses a mock Ember+ provider and virtual X-Touch surfaces.",
      "",
    ].join("\n"),
  );
}

function printError(error: unknown): void {
  if (error instanceof BridgeError) {
    process.stderr.write(`Error: ${error.message}\n`);
    if (error.details && Object.keys(error.details).length > 0) {
      process.stderr.write(`Details: ${JSON.stringify(error.details)}\n`);
    }
    return;
  }
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
}

function waitForShutdown(stop: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    let stopping = false;
    const shutdown = (): void => {
      if (stopping) return;
      stopping = true;
      void stop()
        .catch((error) => {
          process.stderr.write(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}\n`);
        })
        .finally(() => {
          process.removeListener("SIGINT", shutdown);
          process.removeListener("SIGTERM", shutdown);
          resolve();
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function commandRun(args: ParsedArgs): Promise<number> {
  const path = configPath(args);
  const config = loadConfig(path);
  const logger = createLogger(resolveLogLevel(args, config), { pretty: flagBoolean(args, "pretty") });
  if (!config.midi.devices.some((device) => device.enabled)) {
    throw new ConfigError("No enabled MIDI devices in configuration. Copy config/bridge.example.json and bind your ports.", {
      path,
    });
  }
  const armAll = flagBoolean(args, "arm");
  const arming = {
    writes: armAll || flagBoolean(args, "arm-writes"),
    motors: armAll || flagBoolean(args, "arm-motor"),
  };
  if (arming.motors && !arming.writes) {
    logger.warn("cli.motor_without_writes", { message: "Motor feedback also requires --arm-writes" });
  }
  if (
    arming.writes &&
    config.safety.allowedWriteChannels.length === 0 &&
    config.safety.allowedWriteBuses.length === 0 &&
    config.safety.allowedWriteMonitors.length === 0
  ) {
    logger.warn("cli.writes_without_allowlist", {
      message:
        "Writes are armed but safety.allowedWriteChannels, safety.allowedWriteBuses and safety.allowedWriteMonitors are empty",
    });
  }
  if (arming.writes && config.mapping.singleChannel !== null && config.mapping.singleChannelName === null) {
    throw new ConfigError(
      "mapping.singleChannelName is required before arming writes in single-channel mode. Run discover and enter the exact channel name.",
      { path },
    );
  }
  const backend = config.midi.devices.some((device) => device.enabled && device.transport === "usb")
    ? await NativeMidiBackend.create()
    : new EmptyMidiBackend();
  const bridge = new Bridge({ config, arming, backend, logger });
  await bridge.start();
  await waitForShutdown(() => bridge.stop());
  return 0;
}

async function commandDiscover(args: ParsedArgs): Promise<number> {
  const config = loadConfig(configPath(args), { allowMissing: true });
  const host = flagString(args, "host") ?? config.fairlight.host;
  const port = flagNumber(args, "port") ?? config.fairlight.port;
  const logger = createLogger(resolveLogLevel(args, { ...config, logLevel: "warn" }), {
    pretty: flagBoolean(args, "pretty"),
  });
  const client = new EmberFairlightClient({
    host,
    port,
    requestTimeoutMs: config.fairlight.requestTimeoutMs,
    reconnectAttempts: 0,
    autoReconnect: false,
    logger,
    watchAuxSends: configuredAuxTargets(config.mapping),
    watchMonitors: configuredMonitorTargets(config.mapping),
  });
  try {
    await client.connect();
    const snapshot = client.snapshot();
    if (flagBoolean(args, "json")) {
      process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
    } else {
      printSnapshot(snapshot, host, port);
    }
    return 0;
  } catch (error) {
    process.stderr.write(
      `Cannot read Fairlight Ember+ at ${host}:${port}. Check File > Show Settings > Ember+ and the configured server port.\n`,
    );
    throw error;
  } finally {
    await client.disconnect();
  }
}

function printSnapshot(snapshot: FairlightSnapshot, host: string, port: number): void {
  const lines: string[] = [];
  lines.push(`Fairlight Ember+ at ${host}:${port}`);
  lines.push(`On air: ${snapshot.onAir === null ? "unknown" : snapshot.onAir ? "yes" : "no"}`);
  lines.push(`Channels: ${snapshot.channels.length}`);
  for (const channel of snapshot.channels) {
    const writable = [channel.writableLevel ? "level" : null, channel.writableMute ? "mute" : null].filter(Boolean).join(",");
    lines.push(
      `${String(channel.index).padStart(3)}  ${channel.name.padEnd(20)}  level=${formatDb(channel.levelDb)}  mute=${String(channel.muted)}  writable=${writable || "none"}`,
    );
  }
  lines.push(`Buses: ${snapshot.buses.length}`);
  for (const bus of snapshot.buses) {
    lines.push(
      `${bus.type}:${bus.index}  ${bus.name.padEnd(20)}  level=${formatDb(bus.levelDb)}  mute=${String(bus.muted)}  writable=${[
        bus.writableLevel ? "level" : null,
        bus.writableMute ? "mute" : null,
      ]
        .filter(Boolean)
        .join(",") || "none"}`,
    );
  }
  lines.push(`Monitors: ${snapshot.monitors.length}`);
  for (const monitor of snapshot.monitors) {
    lines.push(
      `${String(monitor.index).padStart(3)}  ${monitor.name.padEnd(20)}  level=${formatDb(monitor.levelDb)}  mute=${String(monitor.muted)}  dim=${String(monitor.dimmed)}  writable=${[
        monitor.writableLevel ? "level" : null,
        monitor.writableMute ? "mute" : null,
        monitor.writableDim ? "dim" : null,
      ]
        .filter(Boolean)
        .join(",") || "none"}`,
    );
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function formatDb(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)} dB`;
}

async function commandDoctor(args: ParsedArgs): Promise<number> {
  const path = configPath(args);
  const config = loadConfig(path);
  const host = flagString(args, "host") ?? config.fairlight.host;
  const port = flagNumber(args, "port") ?? config.fairlight.port;
  const logger = createLogger(resolveLogLevel(args, { ...config, logLevel: "warn" }), {
    pretty: flagBoolean(args, "pretty"),
  });

  let ports: MidiPortsSnapshot | { error: string } | null = null;
  let network: DoctorNetworkProbe[] | null = null;
  if (!flagBoolean(args, "skip-midi")) {
    const needsUsb = config.midi.devices.some(
      (device) => device.enabled && device.transport === "usb",
    );
    if (needsUsb) {
      try {
        const backend = await NativeMidiBackend.create();
        ports = { inputs: backend.listInputs(), outputs: backend.listOutputs() };
      } catch (error) {
        ports = { error: error instanceof Error ? error.message : String(error) };
      }
    } else {
      ports = { inputs: [], outputs: [] };
    }
    const networkDevices = config.midi.devices.filter(
      (device) => device.enabled && device.transport === "network" && device.network !== null,
    );
    network = await Promise.all(
      networkDevices.map(async (device) => {
        const endpoint = `${device.network?.host}:${device.network?.port}`;
        const result = await probeRtpMidi({
          host: device.network?.host ?? "",
          port: device.network?.port ?? 0,
          timeoutMs: 2500,
          logger,
        });
        return { role: device.role, endpoint, ok: result.ok, reason: result.reason };
      }),
    );
  }

  let fairlight: { client: FairlightClient } | { error: string } | null = null;
  let client: EmberFairlightClient | null = null;
  if (!flagBoolean(args, "skip-fairlight")) {
    client = new EmberFairlightClient({
      host,
      port,
      requestTimeoutMs: config.fairlight.requestTimeoutMs,
      reconnectAttempts: 0,
      autoReconnect: false,
      logger,
      watchAuxSends: configuredAuxTargets(config.mapping),
      watchMonitors: configuredMonitorTargets(config.mapping),
    });
    try {
      await client.connect();
      fairlight = { client };
    } catch (error) {
      fairlight = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    const report = runDoctor({ config, host, port, ports, fairlight, network });
    if (flagBoolean(args, "json")) {
      process.stdout.write(`${JSON.stringify({ configPath: path, host, port, ...report }, null, 2)}\n`);
    } else {
      printDoctorReport(path, host, port, report);
    }
    return report.summary.fail > 0 ? 1 : 0;
  } finally {
    if (client) await client.disconnect().catch(() => undefined);
  }
}

function printDoctorReport(path: string, host: string, port: number, report: DoctorReport): void {
  const lines: string[] = [`Doctor: ${path}`];
  const midiChecks = report.checks.filter((check) => check.id.startsWith("midi."));
  const otherChecks = report.checks.filter((check) => !check.id.startsWith("midi."));
  const printCheck = (check: DoctorReport["checks"][number]): void => {
    lines.push(`  ${check.status.toUpperCase().padEnd(5)} ${check.message}`);
  };
  if (midiChecks.length > 0) {
    lines.push("", "MIDI");
    for (const check of midiChecks) printCheck(check);
  }
  if (otherChecks.length > 0) {
    lines.push("", `Fairlight: ${host}:${port}`);
    for (const check of otherChecks) printCheck(check);
  }
  lines.push(
    "",
    `Summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    "No MIDI commands were sent and no Fairlight values were written.",
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function commandMidiList(args: ParsedArgs): Promise<number> {
  const config = loadConfig(configPath(args), { allowMissing: true });
  const backend = await NativeMidiBackend.create();
  const inputs = backend.listInputs();
  const outputs = backend.listOutputs();
  const lines: string[] = [];
  lines.push("MIDI inputs:");
  if (inputs.length === 0) lines.push("  (none)");
  for (const port of inputs) lines.push(`  [${port.index}] ${port.name}`);
  lines.push("MIDI outputs:");
  if (outputs.length === 0) lines.push("  (none)");
  for (const port of outputs) lines.push(`  [${port.index}] ${port.name}`);
  if (config.midi.devices.length > 0) {
    lines.push("Configured devices:");
    for (const device of config.midi.devices) {
      if (device.transport === "network") {
        const endpoint = device.network ? `${device.network.host}:${device.network.port}` : "missing";
        lines.push(`  ${device.role}: network=${endpoint} (RTP-MIDI, data port ${(device.network?.port ?? 0) + 1})`);
        continue;
      }
      const input = resolvePort(inputs, device.input);
      const output = resolvePort(outputs, device.output);
      lines.push(
        `  ${device.role}: input=${input.ok ? input.port.info.name : input.reason}; output=${output.ok ? output.port.info.name : output.reason}`,
      );
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

async function commandMidiMonitor(args: ParsedArgs): Promise<number> {
  const config = loadConfig(configPath(args));
  const requested = flagString(args, "device");
  const selected = config.midi.devices.find(
    (device) => device.enabled && (!requested || device.role === requested),
  );
  if (!selected) {
    throw new ConfigError(
      requested ? `No enabled MIDI device with role ${requested}` : "No enabled MIDI device configured",
    );
  }
  const logger = createLogger(resolveLogLevel(args, { ...config, logLevel: "warn" }), {
    pretty: flagBoolean(args, "pretty"),
  });
  const durationSeconds = flagNumber(args, "duration") ?? 15;
  const printMidi = (role: string, message: number[]): void => {
    const decoded = decodeMcuMessage(message);
    const entry = {
      time: new Date().toISOString(),
      role,
      message,
      decoded,
    };
    process.stdout.write(JSON.stringify(entry) + "\n");
  };

  if (selected.transport === "network") {
    const endpoint = selected.network;
    if (!endpoint) throw new ConfigError(`Network endpoint for ${selected.role} is missing`);
    const session = new RtpMidiSession({
      host: endpoint.host,
      port: endpoint.port,
      name: `Fairlight Bridge monitor (${selected.role})`,
      logger,
    });
    session.onEvent((event) => {
      if (event.type === "online") {
        process.stderr.write(`Online: RTP-MIDI ${endpoint.host}:${endpoint.port}\n`);
      } else if (event.type === "offline") {
        process.stderr.write(`Offline: ${event.reason}\n`);
      } else {
        printMidi(selected.role, event.message);
      }
    });
    session.start();
    if (!session.online) {
      process.stderr.write(
        `Waiting for ${selected.role}: ${session.reason ?? `RTP-MIDI ${endpoint.host}:${endpoint.port}`}\n`,
      );
    }
    if (durationSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
      await session.stop();
      return 0;
    }
    await waitForShutdown(() => session.stop());
    return 0;
  }

  const singleConfig: BridgeConfig = {
    ...config,
    midi: { ...config.midi, devices: [selected], requireAllDevices: false },
  };
  const backend = await NativeMidiBackend.create();
  const manager = new MidiDeviceManager(singleConfig.midi, backend, logger);
  manager.onEvent((event) => {
    if (event.type === "online") {
      process.stderr.write(`Online: ${event.inputName} / ${event.outputName}\n`);
    } else if (event.type === "offline") {
      process.stderr.write(`Offline: ${event.reason}\n`);
    } else if (event.type === "midi") {
      printMidi(event.role, event.message);
    }
  });
  manager.start();
  const status = manager.statuses().find((entry) => entry.role === selected.role);
  if (!status?.online) {
    process.stderr.write(`Waiting for ${selected.role}: ${status?.reason ?? "no port"}\n`);
  }
  if (durationSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
    manager.stop();
    return 0;
  }
  await waitForShutdown(async () => manager.stop());
  return 0;
}

async function commandSimulate(args: ParsedArgs): Promise<number> {
  const level = (flagString(args, "log-level") as LogLevel | undefined) ?? "error";
  if (!isLogLevel(level)) throw new ConfigError("--log-level must be one of debug, info, warn, error");
  const logger = createLogger(level, { pretty: flagBoolean(args, "pretty") });
  try {
    const steps = await runSimulation(logger);
    for (const [index, step] of steps.entries()) {
      process.stdout.write(`PASS ${index + 1}: ${step}\n`);
    }
    process.stdout.write(`Simulation complete: ${steps.length} checks passed\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}

async function commandSoak(args: ParsedArgs): Promise<number> {
  const secondsFlag = flagNumber(args, "seconds");
  const minutesFlag = flagNumber(args, "minutes");
  if (secondsFlag !== undefined && minutesFlag !== undefined) {
    throw new ConfigError("Use either --seconds or --minutes, not both");
  }
  const seconds = secondsFlag ?? (minutesFlag !== undefined ? minutesFlag * 60 : 60);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) {
    throw new ConfigError("--seconds must be greater than 0 and at most 86400 (24 hours)");
  }
  const channels = flagNumber(args, "channels") ?? 24;
  if (!Number.isInteger(channels) || channels < 1 || channels > 512) {
    throw new ConfigError("--channels must be 1..512");
  }
  const level = flagString(args, "log-level") ?? "warn";
  if (!isLogLevel(level)) throw new ConfigError("--log-level must be one of debug, info, warn, error");
  const logger = createLogger(level, { pretty: flagBoolean(args, "pretty") });
  const controller = new AbortController();
  void waitForShutdown(async () => {
    controller.abort();
  });
  const result = await runSoak({
    seconds,
    channels,
    logger,
    report: (line) => process.stdout.write(line + "\n"),
    signal: controller.signal,
  });
  return result.ok ? 0 : 1;
}

async function commandMockEmber(args: ParsedArgs): Promise<number> {
  const port = flagNumber(args, "port") ?? 19_000;
  const channels = flagNumber(args, "channels") ?? 24;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError("--port must be 1..65535");
  if (!Number.isInteger(channels) || channels < 1 || channels > 512) throw new ConfigError("--channels must be 1..512");
  const logger = createLogger("info", { pretty: flagBoolean(args, "pretty") });
  const provider = new MockEmberProvider({ port, channelCount: channels, logger });
  await provider.start();
  process.stdout.write(
    `Mock Ember+ provider on 127.0.0.1:${port} with ${channels} channels.\n` +
      `Try: npm run dev -- discover --host 127.0.0.1 --port ${port}\n`,
  );
  await waitForShutdown(() => provider.stop());
  return 0;
}

async function commandSettings(args: ParsedArgs): Promise<number> {
  const demo = flagBoolean(args, "demo");
  const explicitConfig = flagString(args, "config");
  const path = explicitConfig ?? (demo ? "config/bridge.demo.json" : "config/bridge.json");
  const config = demo && !existsSync(path) ? createDemoConfig() : loadConfig(path);
  const port = flagNumber(args, "port") ?? 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("--port must be 1..65535");
  }
  const logger = createLogger(resolveLogLevel(args, { ...config, logLevel: "warn" }), {
    pretty: flagBoolean(args, "pretty"),
  });
  const server = new SettingsServer({
    configPath: path,
    config,
    demo,
    port,
    logger,
    autoDiscover: !flagBoolean(args, "no-discover"),
    backend: demo
      ? undefined
      : config.midi.devices.some((device) => device.enabled && device.transport === "usb")
        ? await NativeMidiBackend.create()
        : new EmptyMidiBackend(),
  });
  const address = await server.start();
  process.stdout.write(
    [
      `Settings page: ${address.url}`,
      demo ? "Mode: demo with three virtual X-Touch surfaces" : "Mode: hardware with the configured MIDI ports",
      `Configuration: ${address.configPath}`,
      "Changes become active when the bridge is restarted. Press Ctrl+C to stop the settings page.",
      "",
    ].join("\n"),
  );
  await waitForShutdown(() => server.stop());
  return 0;
}

async function commandConfigValidate(args: ParsedArgs): Promise<number> {
  const config = loadConfig(configPath(args));
  if (flagBoolean(args, "json")) {
    process.stdout.write(JSON.stringify(config, null, 2) + "\n");
    return 0;
  }
  const lines: string[] = [];
  lines.push("Configuration valid.");
  lines.push(`Fairlight: ${config.fairlight.host}:${config.fairlight.port}`);
  lines.push(`MIDI devices: ${config.midi.devices.length}`);
  for (const device of config.midi.devices) {
    const endpoint =
      device.transport === "network"
        ? `network=${device.network?.host ?? "?"}:${device.network?.port ?? "?"}`
        : `in="${device.input.name}"[${device.input.occurrence}] out="${device.output.name}"[${device.output.occurrence}]`;
    lines.push(`  ${device.role}${device.enabled ? "" : " (disabled)"} [${device.transport}]: ${endpoint}`);
  }
  lines.push(
    `Mapping: bankStep=${config.mapping.bankStep} singleChannel=${config.mapping.singleChannel ?? "off"} expectedName=${config.mapping.singleChannelName ?? "unchecked"}`,
  );
  if (config.mapping.layout) {
    lines.push(`Layout order: ${config.mapping.layout.order.join(" -> ")}`);
    for (const role of config.mapping.layout.order) {
      const surface = config.mapping.layout.surfaces[role];
      if (!surface) continue;
      const fixed = surface.fixedTargets
        .map((target, index) => {
          if (target === null) return null;
          const label = target.kind === "channel" ? `CH${target.channel}` : `${target.busType}:${target.index}`;
          return `F${index + 1}=${label}`;
        })
        .filter(Boolean)
        .join(", ");
      lines.push(`  ${role}: ${surface.mode}${fixed ? ` (${fixed})` : ""}`);
    }
  }
  lines.push(
    `Master: ${config.mapping.master.enabled ? `${config.mapping.master.busType}:${config.mapping.master.busIndex}` : "disabled"}`,
  );
  lines.push(
    `Sends on fader: ${config.mapping.sendsOnFader.enabled ? `aux:${config.mapping.sendsOnFader.busIndex}` : "disabled"}`,
  );
  const assignedButtons = Object.entries(config.mapping.buttonAssignments)
    .map(([button, assignment]) => {
      const label = isButtonId(button) ? buttonLabel(button) : button.toUpperCase();
      return assignment?.type === "monitor-dim"
        ? `${label}=monitor-dim:${assignment.monitorIndex}`
        : `${label}=aux:${assignment?.auxIndex}`;
    })
    .join(", ");
  lines.push(`Button assignments: ${assignedButtons || "none"}`);
  lines.push(`Write channels: ${config.safety.allowedWriteChannels.join(", ") || "none"}`);
  lines.push(`Write buses: ${config.safety.allowedWriteBuses.join(", ") || "none"}`);
  lines.push(`Write monitors: ${config.safety.allowedWriteMonitors.join(", ") || "none"}`);
  lines.push(`Write expiry: ${config.safety.writeExpiryMs} ms`);
  lines.push(`Start alignment: ${config.safety.alignMotorsOnStart ? "on" : "off"}`);
  lines.push(`Bank alignment: ${config.safety.alignMotorsOnBankChange ? "on" : "off"}`);
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgv(argv);
  if (flagBoolean(args, "version")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flagBoolean(args, "help") || args.positionals.length === 0) {
    printHelp();
    return 0;
  }
  const [command, subcommand] = args.positionals;
  if (command === "run") return commandRun(args);
  if (command === "discover") return commandDiscover(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "simulate") return commandSimulate(args);
  if (command === "soak") return commandSoak(args);
  if (command === "mock-ember") return commandMockEmber(args);
  if (command === "settings") return commandSettings(args);
  if (command === "midi") {
    if (subcommand === "list") return commandMidiList(args);
    if (subcommand === "monitor") return commandMidiMonitor(args);
    throw new ConfigError("Usage: bridge midi <list|monitor>");
  }
  if (command === "config" && subcommand === "validate") return commandConfigValidate(args);
  throw new ConfigError(`Unknown command: ${args.positionals.join(" ")}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    printError(error);
    process.exitCode = 1;
  });
