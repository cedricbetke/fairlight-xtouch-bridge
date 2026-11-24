import { mainRoleOf, type BridgeConfig, type SurfaceRole } from "../config.js";
import type { FairlightClient, MonitorState, BusState, ChannelState } from "../fairlight/types.js";
import { auxSendKey, busKey } from "../fairlight/types.js";
import { ChannelMap, STRIPS_PER_SURFACE } from "../mapping/channelMap.js";
import { buttonLabel, isButtonId } from "../mcu/buttons.js";
import { resolvePort, type MidiPortsSnapshot } from "../midi/deviceManager.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: { ok: number; warn: number; fail: number };
}

export interface DoctorInput {
  config: BridgeConfig;
  host: string;
  port: number;
  /** Ports to inspect. `null` skips the MIDI check. */
  ports: MidiPortsSnapshot | { error: string } | null;
  /** Connected client or connect error. `null` skips the Fairlight check. */
  fairlight: { client: FairlightClient } | { error: string } | null;
}

type AddCheck = (
  status: DoctorStatus,
  id: string,
  message: string,
  details?: Record<string, unknown>,
) => void;

const MAX_LISTED_ITEMS = 6;

function listItems(items: readonly string[], empty = "none"): string {
  if (items.length === 0) return empty;
  const shown = items.slice(0, MAX_LISTED_ITEMS).join(", ");
  return items.length > MAX_LISTED_ITEMS ? `${shown}, +${items.length - MAX_LISTED_ITEMS} more` : shown;
}

export function runDoctor(input: DoctorInput): DoctorReport {
  const checks: DoctorCheck[] = [];
  const add: AddCheck = (status, id, message, details) => {
    checks.push(details ? { status, id, message, details } : { status, id, message });
  };
  checkMidi(input, add);
  checkFairlight(input, add);
  if (checks.length === 0) {
    add("warn", "doctor.no_checks", "No checks were run. Remove --skip-midi and --skip-fairlight.");
  }
  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.status] += 1;
  return { checks, summary };
}

function checkMidi(input: DoctorInput, add: AddCheck): void {
  const { config } = input;
  if (input.ports === null) {
    add("warn", "midi.skipped", "MIDI port check skipped");
    return;
  }
  if ("error" in input.ports) {
    add("fail", "midi.scan", `MIDI ports could not be listed: ${input.ports.error}`);
    return;
  }
  const { inputs, outputs } = input.ports;
  const enabled = config.midi.devices.filter((device) => device.enabled);
  if (enabled.length === 0) {
    add("fail", "midi.devices", "No MIDI device is enabled");
    return;
  }

  const claimedInputs = new Map<number, SurfaceRole>();
  const claimedOutputs = new Map<number, SurfaceRole>();
  const sharedNames = new Map<string, SurfaceRole[]>();

  for (const device of enabled) {
    if (device.transport === "network") {
      add(
        "warn",
        `midi.${device.role}`,
        `${device.role}: network transport is configured but not implemented yet`,
        { role: device.role, network: device.network },
      );
      continue;
    }
    const resolvedInput = resolvePort(inputs, device.input);
    const resolvedOutput = resolvePort(outputs, device.output);
    if (!resolvedInput.ok || !resolvedOutput.ok) {
      const reasons = [
        ...new Set(
          [resolvedInput.ok ? null : resolvedInput.reason, resolvedOutput.ok ? null : resolvedOutput.reason].filter(
            (reason): reason is string => Boolean(reason),
          ),
        ),
      ];
      add("fail", `midi.${device.role}`, `${device.role}: ${reasons.join("; ")}`, {
        role: device.role,
        input: device.input,
        output: device.output,
      });
      continue;
    }
    const inputOwner = claimedInputs.get(resolvedInput.port.info.index);
    const outputOwner = claimedOutputs.get(resolvedOutput.port.info.index);
    if (inputOwner || outputOwner) {
      add(
        "fail",
        `midi.${device.role}`,
        `${device.role}: port is already assigned to ${inputOwner ?? outputOwner}`,
        { role: device.role, input: device.input, output: device.output },
      );
      continue;
    }
    claimedInputs.set(resolvedInput.port.info.index, device.role);
    claimedOutputs.set(resolvedOutput.port.info.index, device.role);
    add(
      "ok",
      `midi.${device.role}`,
      `${device.role}: in "${resolvedInput.port.info.name}" [${device.input.occurrence}] out "${resolvedOutput.port.info.name}" [${device.output.occurrence}]`,
      { role: device.role, input: device.input, output: device.output },
    );
    for (const name of [device.input.name, device.output.name]) {
      const roles = sharedNames.get(name) ?? [];
      if (!roles.includes(device.role)) roles.push(device.role);
      sharedNames.set(name, roles);
    }
  }

  for (const [name, roles] of sharedNames) {
    if (roles.length < 2) continue;
    add(
      "warn",
      `midi.shared_name.${name}`,
      `${roles.join(", ")} share the port name "${name}". Verify the occurrence order with a fader test.`,
      { name, roles },
    );
  }
}

function checkFairlight(input: DoctorInput, add: AddCheck): void {
  const { config } = input;
  if (input.fairlight === null) {
    add("warn", "fairlight.skipped", "Fairlight check skipped");
    return;
  }
  if ("error" in input.fairlight) {
    add(
      "fail",
      "fairlight.connect",
      `Cannot read Fairlight Ember+ at ${input.host}:${input.port}: ${input.fairlight.error}`,
      { host: input.host, port: input.port },
    );
    return;
  }
  const client = input.fairlight.client;
  if (!client.connected) {
    add("fail", "fairlight.connect", `Fairlight Ember+ at ${input.host}:${input.port} is not connected`);
    return;
  }

  const snapshot = client.snapshot();
  const channels = new Map<number, ChannelState>(snapshot.channels.map((channel) => [channel.index, channel]));
  const buses = new Map<string, BusState>(
    snapshot.buses.map((bus) => [busKey(bus.type, bus.index), bus]),
  );
  const monitors = new Map<number, MonitorState>(
    snapshot.monitors.map((monitor) => [monitor.index, monitor]),
  );

  if (snapshot.channels.length === 0) {
    add("fail", "fairlight.channels", "Fairlight reported no input channels. Check the show and File > Show Settings > Ember+.");
  } else {
    add(
      "ok",
      "fairlight.channels",
      `${snapshot.channels.length} input channels, ${snapshot.buses.length} buses and ${snapshot.monitors.length} monitors discovered`,
    );
  }

  checkSingleChannel(config, channels, add);
  checkMaster(config, buses, add);
  checkFixedTargets(config, channels, buses, add);
  checkSendsOnFader(config, snapshot, buses, add);
  checkButtonAssignments(config, snapshot, buses, monitors, add);
  checkWriteAllowlists(config, snapshot, add);
}

function checkSingleChannel(
  config: BridgeConfig,
  channels: Map<number, ChannelState>,
  add: AddCheck,
): void {
  const index = config.mapping.singleChannel;
  if (index === null) return;
  const channel = channels.get(index);
  if (!channel) {
    add("fail", "fairlight.single_channel", `Single-channel mode: channel ${index} was not found`, { channel: index });
    return;
  }
  const expected = config.mapping.singleChannelName;
  if (expected === null) {
    add(
      "fail",
      "fairlight.single_channel",
      `Single-channel mode: mapping.singleChannelName is not set. "run --arm-writes" refuses to start.`,
      { channel: index },
    );
    return;
  }
  const matches = [...channels.values()].filter((entry) => entry.name.trim() === expected.trim()).length;
  if (channel.name.trim() !== expected.trim()) {
    add(
      "fail",
      "fairlight.single_channel",
      `Single-channel mode: channel ${index} is named "${channel.name}", expected "${expected}"`,
      { channel: index, expected, actual: channel.name },
    );
    return;
  }
  if (matches > 1) {
    add(
      "fail",
      "fairlight.single_channel",
      `Single-channel mode: the name "${expected}" is used by ${matches} channels`,
      { channel: index, expected, matches },
    );
    return;
  }
  add("ok", "fairlight.single_channel", `Single-channel mode: channel ${index} matches "${expected}"`, {
    channel: index,
    expected,
  });
}

function checkMaster(config: BridgeConfig, buses: Map<string, BusState>, add: AddCheck): void {
  if (!config.mapping.master.enabled) return;
  const { busType, busIndex } = config.mapping.master;
  const key = busKey(busType, busIndex);
  const bus = buses.get(key);
  if (!bus) {
    add("fail", "fairlight.master", `Master: bus ${key} was not found`, { bus: key });
    return;
  }
  const problems: string[] = [];
  if (!bus.writableLevel) problems.push("level is read-only");
  if (!bus.writableMute) problems.push("mute is read-only");
  if (problems.length > 0) {
    add("warn", "fairlight.master", `Master ${key} (${bus.name}): ${problems.join(", ")}`, { bus: key });
    return;
  }
  add("ok", "fairlight.master", `Master ${key} (${bus.name}) is writable`, { bus: key });
}

function checkFixedTargets(
  config: BridgeConfig,
  channels: Map<number, ChannelState>,
  buses: Map<string, BusState>,
  add: AddCheck,
): void {
  const layout = config.mapping.layout;
  if (!layout) return;
  const missing: string[] = [];
  const readOnly: string[] = [];
  let checked = 0;
  for (const role of layout.order) {
    const surface = layout.surfaces[role];
    if (!surface) continue;
    surface.fixedTargets.forEach((target, strip) => {
      if (!target) return;
      checked += 1;
      const label = `${role} strip ${strip + 1}`;
      if (target.kind === "channel") {
        const channel = channels.get(target.channel);
        if (!channel) missing.push(`${label} -> channel ${target.channel}`);
        else if (!channel.writableLevel) readOnly.push(`${label} -> channel ${target.channel} level`);
        return;
      }
      const key = busKey(target.busType, target.index);
      const bus = buses.get(key);
      if (!bus) missing.push(`${label} -> ${key}`);
      else if (!bus.writableLevel) readOnly.push(`${label} -> ${key} level`);
    });
  }
  if (checked === 0) return;
  if (missing.length > 0) {
    add("fail", "fairlight.fixed_targets", `Fixed targets missing in Fairlight: ${listItems(missing)}`, { missing });
    return;
  }
  if (readOnly.length > 0) {
    add("warn", "fairlight.fixed_targets", `Fixed targets exist but are read-only: ${listItems(readOnly)}`, {
      readOnly,
    });
    return;
  }
  add("ok", "fairlight.fixed_targets", `${checked} fixed target(s) found and writable`);
}

function checkSendsOnFader(
  config: BridgeConfig,
  snapshot: ReturnType<FairlightClient["snapshot"]>,
  buses: Map<string, BusState>,
  add: AddCheck,
): void {
  const sends = config.mapping.sendsOnFader;
  if (!sends.enabled) return;
  const key = busKey("aux", sends.busIndex);
  if (!buses.has(key)) {
    add("fail", "fairlight.send_aux", `Sends on fader: ${key} was not found`, { aux: sends.busIndex });
    return;
  }
  const sendKey = auxSendKey(sends.busIndex);
  const writable = snapshot.channels.filter((channel) => channel.sends[sendKey]?.writableLevel).length;
  if (writable === 0) {
    add(
      "warn",
      "fairlight.send_aux",
      `Sends on fader: ${key} exists, but no channel exposes a writable send`,
      { aux: sends.busIndex },
    );
    return;
  }
  add("ok", "fairlight.send_aux", `Sends on fader: ${writable} channel(s) expose a writable send to ${key}`, {
    aux: sends.busIndex,
    channels: writable,
  });
}

function checkButtonAssignments(
  config: BridgeConfig,
  snapshot: ReturnType<FairlightClient["snapshot"]>,
  buses: Map<string, BusState>,
  monitors: Map<number, MonitorState>,
  add: AddCheck,
): void {
  for (const [button, assignment] of Object.entries(config.mapping.buttonAssignments)) {
    if (!assignment) continue;
    const label = isButtonId(button) ? buttonLabel(button) : button.toUpperCase();
    if (assignment.type === "monitor-dim") {
      const monitor = monitors.get(assignment.monitorIndex);
      if (!monitor) {
        add("fail", `fairlight.button.${button}`, `${label}: monitor ${assignment.monitorIndex} was not found`, {
          monitor: assignment.monitorIndex,
        });
        continue;
      }
      if (!monitor.writableDim) {
        add("warn", `fairlight.button.${button}`, `${label}: monitor ${monitor.index} dim is read-only`, {
          monitor: monitor.index,
        });
        continue;
      }
      if (!config.safety.allowedWriteMonitors.includes(monitor.index)) {
        add(
          "warn",
          `fairlight.button.${button}`,
          `${label}: monitor ${monitor.index} (${monitor.name}) was found, but is not in safety.allowedWriteMonitors`,
          { monitor: monitor.index },
        );
        continue;
      }
      add(
        "ok",
        `fairlight.button.${button}`,
        `${label}: monitor ${monitor.index} (${monitor.name}) dim is writable`,
        { monitor: monitor.index },
      );
      continue;
    }
    const aux = assignment.auxIndex;
    const key = busKey("aux", aux);
    if (!buses.has(key)) {
      add("fail", `fairlight.button.${button}`, `${label}: aux ${aux} was not found`, { aux });
      continue;
    }
    const sendKey = auxSendKey(aux);
    const withSend = snapshot.channels.filter((channel) => channel.sends[sendKey]).length;
    if (withSend === 0) {
      add(
        "warn",
        `fairlight.button.${button}`,
        `${label}: aux ${aux} exists, but no channel exposes that send`,
        { aux },
      );
      continue;
    }
    add("ok", `fairlight.button.${button}`, `${label}: aux ${aux} is available on ${withSend} channel(s)`, { aux });
  }
}

function checkWriteAllowlists(
  config: BridgeConfig,
  snapshot: ReturnType<FairlightClient["snapshot"]>,
  add: AddCheck,
): void {
  const maxChannel = snapshot.channels.reduce((max, channel) => Math.max(max, channel.index), 0);
  const mapped = mappedTargets(config, maxChannel);
  const disallowedChannels = [...mapped.channels].filter(
    (channel) => !config.safety.allowedWriteChannels.includes(channel),
  );
  const disallowedBuses = [...mapped.buses].filter(
    (key) => !config.safety.allowedWriteBuses.includes(key),
  );
  if (mapped.channels.size === 0 && mapped.buses.size === 0) return;
  if (disallowedChannels.length === 0 && disallowedBuses.length === 0) {
    add(
      "ok",
      "safety.write_allowlist",
      `Write allowlists cover all ${mapped.channels.size} mapped channel(s) and ${mapped.buses.size} mapped bus(es)`,
    );
    return;
  }
  const parts: string[] = [];
  if (disallowedChannels.length > 0) {
    parts.push(`${disallowedChannels.length} channel(s): ${listItems(disallowedChannels.map(String))}`);
  }
  if (disallowedBuses.length > 0) {
    parts.push(`${disallowedBuses.length} bus(es): ${listItems(disallowedBuses)}`);
  }
  add(
    "warn",
    "safety.write_allowlist",
    `Mapped targets missing from the write allowlists -> read-only: ${parts.join("; ")}`,
    { channels: disallowedChannels, buses: disallowedBuses },
  );
}

function mappedTargets(config: BridgeConfig, channelCount: number): { channels: Set<number>; buses: Set<string> } {
  const roles: SurfaceRole[] = config.midi.devices.map((device) => device.role);
  const enabledRoles = config.midi.devices
    .filter((device) => device.enabled && device.transport !== "network")
    .map((device) => device.role);
  const order = config.mapping.layout?.order ?? roles;
  const map = new ChannelMap(config.mapping, {
    enabledRoles,
    roleOrder: order,
    mainRole: mainRoleOf(config.midi.devices),
  });
  map.setChannelCount(channelCount);
  const channels = new Set<number>();
  const buses = new Set<string>();
  const pages = Math.max(1, map.bankPages);
  for (let page = 0; page < pages; page += 1) {
    map.setBankOffset(page * map.bankStep);
    for (const role of order) {
      for (let strip = 0; strip <= STRIPS_PER_SURFACE; strip += 1) {
        const target = map.resolve(role, strip);
        if (!target) continue;
        if (target.kind === "channel") channels.add(target.channel);
        else if (target.kind === "bus") buses.add(busKey(target.busType, target.index));
      }
    }
  }
  return { channels, buses };
}
