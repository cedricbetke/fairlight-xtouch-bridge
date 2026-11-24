import {
  BUTTON_IDS,
  defaultMainDisplayConfig,
  mainRoleOf,
  type BridgeConfig,
  type BusType,
  type ButtonId,
  type EncoderMode,
  type MainDisplayConfig,
  type MainDisplayScope,
  type RuntimeArming,
  type SurfaceRole,
} from "../config.js";
import type {
  BusField,
  BusState,
  ChannelField,
  ChannelState,
  FairlightClient,
  FairlightEvent,
  MonitorField,
  MonitorState,
  SendState,
} from "../fairlight/types.js";
import { auxSendKey, busKey } from "../fairlight/types.js";
import { clampLcdText, resolveLcdDisplay } from "../lcd/display.js";
import type { LcdColor } from "../lcd/colors.js";
import type { Logger } from "../logger.js";
import { ChannelMap, describeTarget, keyForTarget, type StripTarget } from "../mapping/channelMap.js";
import {
  dbToMeterSegment,
  decodeMcuMessage,
  encodeEncoderRing,
  encodeFader,
  encodeLcdStripColors,
  encodeLcdStripText,
  encodeLed,
  encodeMeter,
  encodeMuteLed,
  MCU_LCD_DEVICE_EXTENDER,
  MCU_LCD_DEVICE_XTOUCH,
  MCU_NOTE_PAN,
  MCU_NOTE_SEND,
  MCU_STATUS_CONTROL_CHANGE,
  type McuEvent,
} from "../mcu/codec.js";
import { buttonLabel, buttonNote } from "../mcu/buttons.js";
import { DEFAULT_FADER_LAW } from "../mcu/faderLaw.js";
import {
  blankSegmentCells,
  MCU_SEGMENT_CC_TIME_BASE,
  segmentUpdatePlan,
  type SegmentCell,
} from "../mcu/segmentDisplay.js";
import type { MidiDeviceEvent } from "../midi/deviceManager.js";
import { mainDisplayCells, type MainDisplayMeterReading } from "./mainDisplay.js";

export interface MidiSink {
  send(role: SurfaceRole, message: number[]): boolean;
}

interface StripRef {
  role: SurfaceRole;
  strip: number;
}

const ENCODER_PAN_STEP = 5;
const ENCODER_RING_MODE = 3;

function panToRing(pan: number): number {
  const clamped = Math.min(100, Math.max(-100, pan));
  return Math.round(((clamped + 100) / 200) * 6);
}

interface StripState extends StripRef {
  touched: boolean;
  armed: boolean;
  blocked: boolean;
  writeFault: "level" | "mute" | "pan" | null;
  lockedTarget: StripTarget | null;
  lastMotorRaw: number | undefined;
  lastMuteLed: boolean | undefined;
  lastPanRing: number | undefined;
  lastMeterSegment: number | undefined;
}

interface PendingWrite {
  stripKey: string;
  role: SurfaceRole;
  strip: number;
  kind: "level" | "mute" | "pan";
  target: StripTarget;
  db?: number;
  muted?: boolean;
  pan?: number;
  session: number;
  enqueuedAt: number;
}

interface InFlightWrite extends PendingWrite {
  startedAt: number;
}

function snapshotSignature(snapshot: ReturnType<FairlightClient["snapshot"]>): string {
  return JSON.stringify({
    channels: snapshot.channels.map((channel) => `${channel.index}:${channel.name}`).sort(),
    buses: snapshot.buses.map((bus) => `${bus.type}:${bus.index}:${bus.name}`).sort(),
  });
}

export interface SyncEngineOptions {
  config: BridgeConfig;
  arming: RuntimeArming;
  fairlight: FairlightClient;
  midi: MidiSink;
  logger: Logger;
}

export interface SyncEngineStatus {
  fairlightConnected: boolean;
  structureLocked: boolean;
  arming: RuntimeArming;
  faderMode: "main" | "send";
  activeAux: number | null;
  mapping: ReturnType<ChannelMap["describe"]>;
  pendingWrites: number;
  inFlight: string | null;
  strips: Array<{
    role: SurfaceRole;
    strip: number;
    target: string | null;
    touched: boolean;
    armed: boolean;
    blocked: boolean;
    writeFault: "level" | "mute" | "pan" | null;
  }>;
}

export class SyncEngine {
  readonly #config: BridgeConfig;
  readonly #fairlight: FairlightClient;
  readonly #midi: MidiSink;
  readonly #logger: Logger;
  readonly #mapping: ChannelMap;
  readonly #arming: RuntimeArming;
  readonly #roles: SurfaceRole[];
  readonly #mainRole: SurfaceRole;
  readonly #mainDisplay: MainDisplayConfig;
  readonly #mainDeviceEnabled: boolean;
  readonly #stripStates = new Map<string, StripState>();
  readonly #channels = new Map<number, ChannelState>();
  readonly #buses = new Map<string, BusState>();
  readonly #monitors = new Map<number, MonitorState>();
  readonly #monitorWrites = new Set<number>();
  #channelStrips = new Map<number, StripRef[]>();
  #busStrips = new Map<string, StripRef[]>();
  #sendStrips = new Map<string, StripRef[]>();
  #sendAux: number | null = null;
  #fairlightConnected = false;
  #onAir: boolean | null = null;
  /** Last successfully written seven-segment frame, left to right. */
  #segmentValues: number[] | null = null;
  #displayTimer: NodeJS.Timeout | undefined;
  #structureLocked = false;
  #structureLockSource: "identity" | "structure" | null = null;
  #structureSignature = "";
  #lockedSignature = "";
  #identityLocked = false;
  #session = 0;
  #pending = new Map<string, PendingWrite>();
  #inFlight: InFlightWrite | null = null;
  #writeTimer: NodeJS.Timeout | undefined;
  #nextWriteAt = 0;
  #unsubscribeFairlight: (() => void) | undefined;
  #started = false;

  constructor(options: SyncEngineOptions) {
    this.#config = options.config;
    this.#fairlight = options.fairlight;
    this.#midi = options.midi;
    this.#logger = options.logger.child({ component: "sync" });
    this.#mainRole = mainRoleOf(options.config.midi.devices);
    const deviceOrder = options.config.midi.devices.map((device) => device.role);
    const layoutOrder = options.config.mapping.layout?.order ?? deviceOrder;
    const enabledRoles = options.config.midi.devices
      .filter((device) => device.enabled)
      .map((device) => device.role);
    const orderedEnabled = layoutOrder.filter((role) => enabledRoles.includes(role));
    for (const role of enabledRoles) {
      if (!orderedEnabled.includes(role)) orderedEnabled.push(role);
    }
    this.#roles = orderedEnabled.length > 0 ? orderedEnabled : [...deviceOrder];
    this.#mapping = new ChannelMap(options.config.mapping, {
      enabledRoles,
      roleOrder: layoutOrder,
      mainRole: this.#mainRole,
    });
    this.#arming = { ...options.arming };
    const mainDevice = options.config.midi.devices.find((device) => device.role === this.#mainRole);
    this.#mainDisplay = mainDevice?.mainDisplay ?? defaultMainDisplayConfig();
    this.#mainDeviceEnabled = mainDevice?.enabled ?? true;
    this.#ensureStripStates();
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribeFairlight = this.#fairlight.onEvent((event) => this.#handleFairlightEvent(event));
    if (this.#fairlight.connected) {
      this.#fairlightConnected = true;
      this.#intoConnectedState();
      this.#applySnapshot(this.#fairlight.snapshot(), true);
      this.#alignMotors("bridge started", this.#config.safety.alignMotorsOnStart);
    }
    if (this.#mainDisplay.mode === "clock" && this.#mainDeviceEnabled) {
      this.#displayTimer = setInterval(() => this.#refreshMainDisplay("clock"), 1000);
      this.#displayTimer.unref();
      this.#refreshMainDisplay("clock started");
    }
    this.#logger.info("sync.started", { arming: this.#arming, mapping: this.#mapping.describe() });
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#unsubscribeFairlight?.();
    this.#unsubscribeFairlight = undefined;
    this.#invalidateWrites("bridge stopped");
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = undefined;
    }
    if (this.#displayTimer) {
      clearInterval(this.#displayTimer);
      this.#displayTimer = undefined;
    }
    this.#clearMainDisplay("bridge stopped");
  }

  setArming(arming: RuntimeArming): void {
    this.#arming.writes = arming.writes;
    this.#arming.motors = arming.motors;
    if (!arming.writes) this.#invalidateWrites("writes disarmed");
    if (!arming.motors) {
      for (const state of this.#stripStates.values()) state.armed = false;
    }
    this.#logger.info("sync.arming_changed", { arming: this.#arming });
  }

  handleDeviceEvent(event: MidiDeviceEvent): void {
    if (event.type === "online") {
      for (const state of this.#stripStates.values()) {
        if (state.role !== event.role) continue;
        state.armed = false;
        state.touched = false;
        state.blocked = false;
        state.writeFault = null;
        state.lockedTarget = null;
        state.lastMotorRaw = undefined;
        state.lastMuteLed = undefined;
        state.lastPanRing = undefined;
        state.lastMeterSegment = undefined;
      }
      this.#repaintLeds(event.role);
      this.#repaintRingsForRole(event.role);
      this.#refreshDisplaysForRole(event.role);
      if (event.role === this.#mainRole) {
        this.#updateAssignLeds();
        // A reconnected unit shows stale digits, so rewrite the full frame.
        this.#segmentValues = null;
        this.#refreshMainDisplay("device online");
      }
      this.#alignMotorsForRole(event.role, "device online");
      this.#logger.info("sync.device_online", { role: event.role });
      return;
    }
    if (event.type === "offline") {
      for (const [key, state] of this.#stripStates) {
        if (state.role !== event.role) continue;
        state.armed = false;
        state.touched = false;
        state.blocked = false;
        state.writeFault = null;
        state.lockedTarget = null;
        state.lastMotorRaw = undefined;
        state.lastMuteLed = undefined;
        state.lastPanRing = undefined;
        state.lastMeterSegment = undefined;
        this.#dropPendingByStrip(key);
      }
      this.#logger.info("sync.device_offline", { role: event.role, reason: event.reason });
      return;
    }
    const decoded = decodeMcuMessage(event.message);
    if (!decoded) {
      this.#logger.debug("sync.midi_unhandled", { role: event.role, message: event.message });
      return;
    }
    this.#handleMcuEvent(event.role, decoded);
  }

  status(): SyncEngineStatus {
    return {
      fairlightConnected: this.#fairlightConnected,
      structureLocked: this.#structureLocked,
      arming: { ...this.#arming },
      faderMode: this.#sendAux === null ? "main" : "send",
      activeAux: this.#sendAux,
      mapping: this.#mapping.describe(),
      pendingWrites: this.#pending.size,
      inFlight: this.#inFlight ? `${this.#inFlight.stripKey}:${this.#inFlight.kind}` : null,
      strips: [...this.#stripStates.values()].map((state) => {
        const target = this.#activeTarget(state.role, state.strip);
        return {
          role: state.role,
          strip: state.strip,
          target: target ? describeTarget(target) : null,
          touched: state.touched,
          armed: state.armed,
          blocked: state.blocked,
          writeFault: state.writeFault,
        };
      }),
    };
  }

  #handleMcuEvent(role: SurfaceRole, event: McuEvent): void {
    switch (event.type) {
      case "fader":
        this.#handleFader(role, event.strip, event.raw);
        return;
      case "touch":
        this.#handleTouch(role, event.strip, event.touched);
        return;
      case "button":
        if (!event.pressed) return;
        if (event.button === "flip") {
          this.#logger.debug("sync.flip_ignored", { role });
          return;
        }
        if (event.strip === null) return;
        if (event.button === "mute") this.#handleMute(role, event.strip);
        else if (event.button === "select") {
          this.#logger.debug("sync.select_ignored", { role, strip: event.strip, reason: "Ember+ select path unverified" });
        } else if (event.button === "solo") {
          this.#logger.debug("sync.solo_ignored", { role, strip: event.strip, reason: "Ember+ solo path unverified" });
        } else if (event.button === "record") {
          this.#logger.debug("sync.record_ignored", { role, strip: event.strip });
        } else if (event.button === "encoder-push") {
          this.#handleEncoderPush(role, event.strip);
        }
        return;
      case "encoder":
        this.#handleEncoder(role, event.strip, event.delta);
        return;
      case "bank":
        if (role !== this.#mainRole) {
          this.#logger.debug("sync.bank_ignored", { role, reason: "bank controls are on the main X-Touch" });
          return;
        }
        this.#handleBank(event.direction);
        return;
      case "channel-nav":
        this.#logger.debug("sync.channel_nav_ignored", { direction: event.direction });
        return;
      case "assign":
        if (role !== this.#mainRole) {
          this.#logger.debug("sync.assign_ignored", { role, reason: "assign buttons are on the main X-Touch" });
          return;
        }
        this.#handleAssign(event.assign);
        return;
      case "function":
        if (role !== this.#mainRole) {
          this.#logger.debug("sync.function_ignored", { role, button: event.button });
          return;
        }
        this.#handleFunctionButton(event.button);
        return;
      case "jog":
        this.#logger.debug("sync.jog_ignored", { role, delta: event.delta });
        return;
    }
  }

  #handleFader(role: SurfaceRole, strip: number, raw: number): void {
    const state = this.#getStripState(role, strip);
    if (!this.#arming.writes) {
      this.#logIgnored(state, "writes_not_armed");
      return;
    }
    if (this.#config.safety.requireTouchForWrites && !state.touched) {
      this.#logIgnored(state, "fader_without_touch");
      return;
    }
    if (state.blocked) {
      this.#logIgnored(state, "strip_blocked_after_structure_change");
      return;
    }
    if (state.writeFault !== null) {
      this.#logIgnored(state, "strip_blocked_after_unconfirmed_write");
      return;
    }
    const target = state.touched ? state.lockedTarget : this.#activeTarget(role, strip);
    if (!target) {
      this.#logIgnored(state, "no_target_mapped");
      return;
    }
    if (!this.#canWriteTarget(target)) {
      this.#logIgnored(state, "target_not_in_write_allowlist");
      return;
    }
    const stateForTarget = this.#stateForTarget(target);
    if (!stateForTarget || !stateForTarget.writableLevel) {
      this.#logIgnored(state, "target_level_not_writable");
      return;
    }
    const db = DEFAULT_FADER_LAW.rawToDb(raw);
    this.#enqueue({
      stripKey: this.#stripKey(role, strip),
      role,
      strip,
      kind: "level",
      target,
      db,
      session: this.#session,
      enqueuedAt: Date.now(),
    });
  }

  #handleTouch(role: SurfaceRole, strip: number, touched: boolean): void {
    const state = this.#getStripState(role, strip);
    if (touched) {
      if (!state.touched) {
        state.touched = true;
        state.blocked = false;
        state.lockedTarget = this.#activeTarget(role, strip);
        state.lastMotorRaw = undefined;
        this.#logger.debug("sync.touch_down", {
          role,
          strip,
          target: state.lockedTarget ? describeTarget(state.lockedTarget) : null,
        });
      }
      return;
    }

    state.touched = false;
    const target = state.lockedTarget;
    state.lockedTarget = null;
    if (state.blocked) {
      state.blocked = false;
      state.armed = false;
      this.#logger.warn("sync.touch_release_blocked", { role, strip });
      return;
    }
    if (state.writeFault !== null) {
      state.armed = false;
      this.#logger.warn("sync.touch_release_write_fault", { role, strip });
      return;
    }
    if (!target || !this.#motorAllowedFor(target)) {
      state.armed = false;
      this.#logger.debug("sync.touch_up_no_motor", { role, strip, target: target ? describeTarget(target) : null });
      return;
    }
    state.armed = true;
    if (this.#isLevelWritePending(state)) {
      this.#logger.debug("sync.touch_up_motor_deferred_for_write", { role, strip });
      return;
    }
    const level = this.#levelForTarget(target);
    if (level === null) return;
    this.#sendMotor(state, level);
  }

  #handleEncoder(role: SurfaceRole, strip: number, delta: number): void {
    const mode = this.#encoderMode(role);
    if (mode !== "pan") {
      if (mode === "off" && delta !== 0) {
        this.#logger.debug("sync.encoder_ignored", { role, strip, delta, reason: "encoder function off" });
      }
      return;
    }
    if (delta === 0) return;
    const target = this.#mapping.resolve(role, strip);
    if (!target) {
      this.#logger.debug("sync.pan_ignored_no_target", { role, strip });
      return;
    }
    const source = this.#stateForTarget(target);
    if (!source || source.pan === null || !source.writablePan) {
      this.#logger.debug("sync.pan_ignored_not_writable", { role, strip, target: describeTarget(target) });
      return;
    }
    if (!this.#arming.writes) {
      this.#logger.debug("sync.pan_ignored_writes_not_armed", { role, strip });
      return;
    }
    if (!this.#canWriteTarget(target)) {
      this.#logger.debug("sync.pan_ignored_not_allowed", { role, strip, target: describeTarget(target) });
      return;
    }
    const base = this.#panBase(this.#stripKey(role, strip), target);
    const next = Math.min(100, Math.max(-100, Math.round(base + delta * ENCODER_PAN_STEP)));
    if (next === Math.round(base)) return;
    this.#enqueue({
      stripKey: this.#stripKey(role, strip),
      role,
      strip,
      kind: "pan",
      target,
      pan: next,
      session: this.#session,
      enqueuedAt: Date.now(),
    });
  }

  #handleEncoderPush(role: SurfaceRole, strip: number): void {
    if (this.#encoderMode(role) !== "pan") {
      this.#logger.debug("sync.encoder_push_ignored", { role, strip, reason: "encoder function not pan" });
      return;
    }
    const target = this.#mapping.resolve(role, strip);
    if (!target) return;
    const source = this.#stateForTarget(target);
    if (!source || source.pan === null || !source.writablePan) return;
    if (!this.#arming.writes || !this.#canWriteTarget(target)) return;
    if (source.pan === 0) return;
    this.#enqueue({
      stripKey: this.#stripKey(role, strip),
      role,
      strip,
      kind: "pan",
      target,
      pan: 0,
      session: this.#session,
      enqueuedAt: Date.now(),
    });
  }

  #panBase(stripKey: string, target: StripTarget): number {
    const pending = this.#pending.get(`${stripKey}:pan`);
    if (pending && pending.pan !== undefined) return pending.pan;
    if (this.#inFlight && this.#inFlight.stripKey === stripKey && this.#inFlight.kind === "pan") {
      return this.#inFlight.pan ?? 0;
    }
    return this.#stateForTarget(target)?.pan ?? 0;
  }

  #encoderMode(role: SurfaceRole): EncoderMode {
    return this.#config.midi.devices.find((device) => device.role === role)?.encoder ?? "off";
  }

  #metersEnabled(role: SurfaceRole): boolean {
    return this.#config.midi.devices.find((device) => device.role === role)?.meters ?? false;
  }

  #handleMute(role: SurfaceRole, strip: number): void {
    if (!this.#arming.writes) {
      this.#logger.debug("sync.mute_ignored_writes_not_armed", { role, strip });
      return;
    }
    const target = this.#mapping.resolve(role, strip);
    if (!target) {
      this.#logger.debug("sync.mute_ignored_no_target", { role, strip });
      return;
    }
    if (!this.#canWriteTarget(target)) {
      this.#logger.debug("sync.mute_ignored_not_allowed", { role, strip, target: describeTarget(target) });
      return;
    }
    const state = this.#getStripState(role, strip);
    if (state.writeFault !== null) {
      this.#logger.debug("sync.mute_ignored_write_fault", { role, strip, target: describeTarget(target) });
      return;
    }
    const source = this.#stateForTarget(target);
    if (!source || source.muted === null || !source.writableMute) {
      this.#logger.debug("sync.mute_ignored_not_writable", { role, strip, target: describeTarget(target) });
      return;
    }
    this.#enqueue({
      stripKey: this.#stripKey(role, strip),
      role,
      strip,
      kind: "mute",
      target,
      muted: !source.muted,
      session: this.#session,
      enqueuedAt: Date.now(),
    });
  }

  #handleBank(direction: "left" | "right"): void {
    if ([...this.#stripStates.values()].some((state) => state.touched)) {
      this.#logger.warn("sync.bank_ignored_while_touched", { direction });
      return;
    }
    if (!this.#mapping.bank(direction)) {
      this.#logger.info("sync.bank_at_limit", { direction, bankOffset: this.#mapping.bankOffset });
      return;
    }
    this.#session += 1;
    this.#invalidateWrites("bank changed");
    for (const state of this.#stripStates.values()) {
      state.armed = false;
      state.lastMotorRaw = undefined;
      state.lastMuteLed = undefined;
      state.lastPanRing = undefined;
      state.lastMeterSegment = undefined;
    }
    this.#rebuildBindingIndexes();
    this.#repaintAllLeds();
    this.#repaintAllRings();
    this.#clearAllMeters();
    this.#refreshDisplays();
    this.#refreshMainDisplay("bank changed");
    this.#alignMotors("bank changed", this.#config.safety.alignMotorsOnBankChange);
    this.#logger.info("sync.bank_changed", {
      direction,
      bankOffset: this.#mapping.bankOffset,
      mapping: this.#mapping.describe(),
      motors_disarmed: true,
    });
  }

  #handleAssign(assign: "send" | "pan"): void {
    if (assign === "pan") {
      this.#setSendAux(null, "PAN");
      return;
    }
    if (!this.#config.mapping.sendsOnFader.enabled) {
      this.#logger.info("sync.send_mode_disabled", { aux: this.#config.mapping.sendsOnFader.busIndex });
      return;
    }
    this.#setSendAux(this.#config.mapping.sendsOnFader.busIndex, "SEND");
  }

  #handleFunctionButton(button: ButtonId): void {
    const assignment = this.#config.mapping.buttonAssignments[button];
    if (!assignment) {
      this.#logger.debug("sync.function_button_unassigned", { button });
      return;
    }
    const source = buttonLabel(button);
    if (assignment.type === "sends-on-fader") {
      this.#setSendAux(assignment.auxIndex, source);
      return;
    }
    this.#toggleMonitorDim(assignment.monitorIndex, source);
  }

  #toggleMonitorDim(monitorIndex: number, source: string): void {
    if (!this.#arming.writes) {
      this.#logger.debug("sync.monitor_dim_ignored_writes_not_armed", { monitor: monitorIndex, source });
      return;
    }
    if (this.#structureLocked) {
      this.#logger.debug("sync.monitor_dim_ignored_structure_locked", { monitor: monitorIndex, source });
      return;
    }
    if (!this.#fairlightConnected || !this.#fairlight.connected) {
      this.#logger.debug("sync.monitor_dim_ignored_offline", { monitor: monitorIndex, source });
      return;
    }
    if (!this.#config.safety.allowedWriteMonitors.includes(monitorIndex)) {
      this.#logger.debug("sync.monitor_dim_ignored_not_allowed", { monitor: monitorIndex, source });
      return;
    }
    const monitor = this.#monitors.get(monitorIndex);
    if (!monitor) {
      this.#logger.warn("sync.monitor_dim_missing", { monitor: monitorIndex, source });
      return;
    }
    if (monitor.dimmed === null || !monitor.writableDim) {
      this.#logger.debug("sync.monitor_dim_ignored_not_writable", { monitor: monitorIndex, source });
      return;
    }
    if (this.#monitorWrites.has(monitorIndex)) {
      this.#logger.debug("sync.monitor_dim_ignored_busy", { monitor: monitorIndex, source });
      return;
    }
    const session = this.#session;
    const requested = !monitor.dimmed;
    this.#monitorWrites.add(monitorIndex);
    void this.#fairlight
      .setMonitorDim(monitorIndex, requested)
      .then((confirmed) => {
        if (session !== this.#session) {
          this.#logger.warn("sync.monitor_dim_confirmation_stale_session", {
            monitor: monitorIndex,
            source,
          });
          return;
        }
        const current = this.#monitors.get(monitorIndex);
        if (current) current.dimmed = confirmed;
        this.#updateAssignLeds();
        this.#logger.info("sync.monitor_dim_written", { monitor: monitorIndex, dimmed: confirmed, source });
      })
      .catch((error) => {
        this.#logger.error("sync.monitor_dim_failed", { monitor: monitorIndex, source, error });
      })
      .finally(() => {
        this.#monitorWrites.delete(monitorIndex);
      });
  }

  #setSendAux(aux: number | null, source: string): void {
    if (aux === this.#sendAux) return;
    if (aux !== null && !this.#buses.has(busKey("aux", aux))) {
      this.#logger.warn("sync.send_aux_missing", { aux, source });
      return;
    }
    if ([...this.#stripStates.values()].some((state) => state.touched)) {
      this.#logger.warn("sync.fader_mode_ignored_while_touched", { aux, source });
      return;
    }
    this.#sendAux = aux;
    this.#session += 1;
    this.#invalidateWrites("fader mode changed");
    for (const state of this.#stripStates.values()) {
      state.armed = false;
      state.lastMotorRaw = undefined;
    }
    this.#rebuildBindingIndexes();
    this.#refreshDisplays();
    this.#refreshMainDisplay("fader mode changed");
    this.#updateAssignLeds();
    this.#alignMotors("fader mode changed", this.#config.safety.alignMotorsOnBankChange);
    this.#logger.info("sync.fader_mode_changed", {
      mode: aux === null ? "main" : "send",
      aux: aux ?? undefined,
      source,
      motors_disarmed: true,
    });
  }

  #handleFairlightEvent(event: FairlightEvent): void {
    switch (event.type) {
      case "connected":
        this.#fairlightConnected = true;
        this.#onAir = event.snapshot.onAir;
        this.#session += 1;
        this.#intoConnectedState();
        this.#applySnapshot({
          revision: event.snapshot.revision,
          discoveredAt: event.snapshot.discoveredAt,
          onAir: event.snapshot.onAir,
          channels: event.snapshot.channels,
          buses: event.snapshot.buses,
          monitors: event.snapshot.monitors,
        }, true);
        this.#logger.info("sync.fairlight_connected", {
          channels: event.snapshot.channels.length,
          buses: event.snapshot.buses.length,
        });
        this.#settleStructureLock("fairlight connected", event.snapshot.channels.length, event.snapshot.buses.length);
        this.#alignMotors("fairlight connected", this.#config.safety.alignMotorsOnStart);
        return;
      case "disconnected":
        this.#fairlightConnected = false;
        this.#session += 1;
        this.#invalidateWrites("fairlight disconnected");
        for (const state of this.#stripStates.values()) {
          state.armed = false;
          state.touched = false;
          state.blocked = false;
          state.writeFault = null;
          state.lockedTarget = null;
        }
        this.#clearAllMeters();
        this.#monitors.clear();
        this.#updateAssignLeds();
        this.#onAir = null;
        this.#refreshMainDisplay("fairlight disconnected");
        this.#logger.warn("sync.fairlight_disconnected", { reason: event.reason });
        return;
      case "snapshot": {
        this.#session += 1;
        this.#invalidateWrites("fairlight snapshot");
        this.#applySnapshot(event.snapshot, true);
        this.#settleStructureLock("fairlight snapshot", event.snapshot.channels.length, event.snapshot.buses.length);
        return;
      }
      case "channel":
        this.#applyChannelUpdate(event.channel, event.changed);
        return;
      case "bus":
        this.#applyBusUpdate(event.bus, event.changed);
        this.#refreshMeterDisplayForBus(event.bus, event.changed);
        return;
      case "monitor":
        this.#applyMonitorUpdate(event.monitor, event.changed);
        return;
      case "system":
        // On-air stays read-only; it only feeds the optional display mode.
        if (event.onAir !== this.#onAir) {
          this.#onAir = event.onAir;
          this.#refreshMainDisplay("on-air changed");
        }
        return;
      case "structure-change-detected":
        this.#lockStructure(event.reason);
        return;
      case "structure-changed":
        this.#session += 1;
        this.#invalidateWrites("fairlight structure changed");
        if (!this.#structureLocked) {
          this.#lockedSignature = this.#structureSignature;
          this.#structureLocked = true;
        }
        this.#structureLockSource = "structure";
        for (const state of this.#stripStates.values()) {
          state.armed = false;
          state.lastMotorRaw = undefined;
          if (state.touched) state.blocked = true;
        }
        this.#clearAllMeters();
        this.#refreshMainDisplay("structure changed");
        this.#logger.warn("sync.structure_changed", { summary: event.summary });
        return;
      case "structure-revalidated":
        if (
          this.#structureLocked &&
          this.#structureLockSource === "structure" &&
          !this.#identityLocked &&
          this.#structureSignature === this.#lockedSignature
        ) {
          this.#structureLocked = false;
          this.#structureLockSource = null;
          this.#logger.info("sync.structure_revalidated");
        } else if (this.#structureLocked) {
          this.#logger.error("sync.structure_revalidation_mismatch", {
            expectedSignature: this.#lockedSignature,
            currentSignature: this.#structureSignature,
          });
        }
        return;
      case "warning":
        this.#logger.warn("sync.fairlight_warning", { message: event.message });
        return;
    }
  }

  #lockStructure(reason: string): void {
    if (!this.#structureLocked) {
      this.#lockedSignature = this.#structureSignature;
      this.#structureLocked = true;
      this.#logger.warn("sync.structure_locked", { reason });
    }
    this.#structureLockSource = "structure";
    this.#session += 1;
    this.#invalidateWrites("structure change detected");
    for (const state of this.#stripStates.values()) {
      state.armed = false;
      state.lastMotorRaw = undefined;
      if (state.touched) state.blocked = true;
    }
  }

  #intoConnectedState(): void {
    this.#invalidateWrites("fairlight connected");
    for (const state of this.#stripStates.values()) {
      state.armed = false;
      state.touched = false;
      state.blocked = false;
      state.writeFault = null;
      state.lockedTarget = null;
      state.lastMotorRaw = undefined;
      state.lastMuteLed = undefined;
      state.lastPanRing = undefined;
      state.lastMeterSegment = undefined;
    }
  }

  #applySnapshot(snapshot: ReturnType<FairlightClient["snapshot"]>, resetArmed: boolean): void {
    this.#onAir = snapshot.onAir;
    this.#channels.clear();
    for (const channel of snapshot.channels) this.#channels.set(channel.index, { ...channel });
    this.#buses.clear();
    for (const bus of snapshot.buses) this.#buses.set(busKey(bus.type, bus.index), { ...bus });
    this.#monitors.clear();
    for (const monitor of snapshot.monitors) this.#monitors.set(monitor.index, { ...monitor });
    if (this.#sendAux !== null && !this.#buses.has(busKey("aux", this.#sendAux))) {
      this.#logger.warn("sync.send_aux_missing", { aux: this.#sendAux, source: "snapshot" });
      this.#sendAux = null;
    }
    const maxChannel = snapshot.channels.reduce((max, channel) => Math.max(max, channel.index), 0);
    this.#mapping.setChannelCount(maxChannel);
    this.#structureSignature = snapshotSignature(snapshot);
    if (resetArmed) {
      for (const state of this.#stripStates.values()) {
        state.armed = false;
        state.writeFault = null;
        state.lastMotorRaw = undefined;
        state.lastMuteLed = undefined;
        state.lastPanRing = undefined;
        state.lastMeterSegment = undefined;
      }
    }
    this.#checkSingleChannelIdentity();
    this.#rebuildBindingIndexes();
    this.#warnMissingBindings();
    this.#repaintAllLeds();
    this.#repaintAllRings();
    this.#clearAllMeters();
    this.#refreshDisplays();
    this.#refreshMainDisplay("snapshot");
    this.#updateAssignLeds();
    this.#logger.info("sync.snapshot_applied", {
      channels: snapshot.channels.length,
      buses: snapshot.buses.length,
      channelCount: maxChannel,
      bankOffset: this.#mapping.bankOffset,
    });
  }

  #settleStructureLock(reason: string, channels: number, buses: number): void {
    if (!this.#structureLocked) return;
    if (this.#structureLockSource === "structure" && !this.#identityLocked) {
      this.#structureLocked = false;
      this.#structureLockSource = null;
      this.#lockedSignature = this.#structureSignature;
      this.#logger.info("sync.structure_accepted", {
        reason,
        channels,
        buses,
        channelCount: this.#mapping.channelCount,
        bankOffset: this.#mapping.bankOffset,
      });
      this.#alignMotors("structure accepted", this.#config.safety.alignMotorsOnStart);
      return;
    }
    this.#logger.warn("sync.structure_lock_retained", {
      reason,
      source: this.#structureLockSource,
      identityLocked: this.#identityLocked,
      expectedSignature: this.#lockedSignature,
      currentSignature: this.#structureSignature,
    });
  }

  #checkSingleChannelIdentity(): void {
    this.#recheckSingleChannelIdentity();
  }

  #recheckSingleChannelIdentity(): void {
    const channelIndex = this.#config.mapping.singleChannel;
    if (channelIndex === null) return;
    const channel = this.#channels.get(channelIndex);
    this.#checkChannelIdentity(channelIndex, channel?.name ?? null);
  }

  #checkChannelIdentity(channelIndex: number, actualName: string | null): void {
    if (this.#config.mapping.singleChannel !== channelIndex) return;
    const expectedName = this.#config.mapping.singleChannelName;
    if (expectedName === null) return;
    const matchingChannels = [...this.#channels.values()].filter(
      (channel) => channel.name.trim() === expectedName.trim(),
    ).length;
    if (
      actualName !== null &&
      actualName.trim() === expectedName.trim() &&
      matchingChannels === 1
    ) {
      if (this.#identityLocked) {
        this.#identityLocked = false;
        if (this.#structureLockSource === "identity") {
          this.#structureLocked = false;
          this.#structureLockSource = null;
        }
        this.#logger.info("sync.single_channel_identity_recovered", {
          channel: channelIndex,
          name: expectedName,
        });
      } else {
        this.#logger.info("sync.single_channel_identity_ok", {
          channel: channelIndex,
          name: expectedName,
        });
      }
      return;
    }
    this.#identityLocked = true;
    if (!this.#structureLocked) {
      this.#lockedSignature = this.#structureSignature;
      this.#structureLocked = true;
      this.#structureLockSource = "identity";
      this.#session += 1;
      this.#invalidateWrites("single channel identity mismatch");
      for (const state of this.#stripStates.values()) {
        state.armed = false;
        state.lastMotorRaw = undefined;
        if (state.touched) state.blocked = true;
      }
      this.#logger.warn("sync.structure_locked", { reason: "single channel identity mismatch" });
    }
    this.#logger.error("sync.single_channel_identity_mismatch", {
      channel: channelIndex,
      expectedName,
      actualName,
      matchingChannels,
    });
  }

  #applyChannelUpdate(channel: ChannelState, changed: ChannelField[]): void {
    this.#channels.set(channel.index, { ...channel });
    if (changed.includes("name")) {
      this.#recheckSingleChannelIdentity();
      this.#refreshDisplayForChannel(channel.index);
    }
    if (changed.includes("mute")) {
      for (const ref of this.#channelStrips.get(channel.index) ?? []) {
        this.#updateMuteLed(this.#getStripState(ref.role, ref.strip), channel.muted);
      }
    }
    if (changed.includes("level") && channel.levelDb !== null) {
      this.#clearWriteFault({ kind: "channel", channel: channel.index }, "level");
      this.#sendMotorForTarget({ kind: "channel", channel: channel.index }, channel.levelDb);
      if (this.#lcdUsesValueLine()) this.#refreshDisplayForChannel(channel.index);
    }
    if (changed.includes("send")) {
      this.#rebuildBindingIndexes();
      this.#refreshDisplayForChannel(channel.index);
      const sendTarget = this.#sendTargetForChannel(channel.index);
      const send = sendTarget ? this.#stateForTarget(sendTarget) : null;
      if (sendTarget && send?.levelDb !== null && send?.levelDb !== undefined) {
        this.#clearWriteFault(sendTarget, "level");
        this.#sendMotorForTarget(sendTarget, send.levelDb);
      }
    }
    if (changed.includes("mute")) {
      this.#clearWriteFault({ kind: "channel", channel: channel.index }, "mute");
    }
    if (changed.includes("pan") && channel.pan !== null) {
      this.#clearWriteFault({ kind: "channel", channel: channel.index }, "pan");
      this.#sendRingForTarget({ kind: "channel", channel: channel.index }, channel.pan);
    }
    if (changed.includes("meter") && channel.meterDb !== null) {
      this.#sendMeterForTarget({ kind: "channel", channel: channel.index }, channel.meterDb);
    }
  }

  #applyBusUpdate(bus: BusState, changed: BusField[]): void {
    this.#buses.set(busKey(bus.type, bus.index), { ...bus });
    if (changed.includes("name")) this.#refreshDisplayForBus(bus.type, bus.index);
    if (bus.levelDb !== null && changed.includes("level")) {
      this.#clearWriteFault({ kind: "bus", busType: bus.type, index: bus.index }, "level");
      this.#sendMotorForTarget({ kind: "bus", busType: bus.type, index: bus.index }, bus.levelDb);
      if (this.#lcdUsesValueLine()) this.#refreshDisplayForBus(bus.type, bus.index);
    }
    if (changed.includes("mute")) {
      this.#clearWriteFault({ kind: "bus", busType: bus.type, index: bus.index }, "mute");
      const refs = this.#busStrips.get(keyForTarget({ kind: "bus", busType: bus.type, index: bus.index })) ?? [];
      for (const ref of refs) {
        this.#updateMuteLed(this.#getStripState(ref.role, ref.strip), bus.muted);
      }
    }
    if (changed.includes("pan") && bus.pan !== null) {
      this.#clearWriteFault({ kind: "bus", busType: bus.type, index: bus.index }, "pan");
      this.#sendRingForTarget({ kind: "bus", busType: bus.type, index: bus.index }, bus.pan);
    }
    if (changed.includes("meter") && bus.meterDb !== null) {
      this.#sendMeterForTarget({ kind: "bus", busType: bus.type, index: bus.index }, bus.meterDb);
    }
  }

  #applyMonitorUpdate(monitor: MonitorState, changed: MonitorField[]): void {
    this.#monitors.set(monitor.index, { ...monitor });
    if (changed.includes("dim")) this.#updateAssignLeds();
  }

  #clearWriteFault(target: StripTarget, field: "level" | "mute" | "pan"): void {
    for (const ref of this.#stripsForTarget(target)) {
      const state = this.#getStripState(ref.role, ref.strip);
      if (state.writeFault !== field) continue;
      state.writeFault = null;
      this.#logger.info("sync.write_fault_cleared", {
        role: state.role,
        strip: state.strip,
        target: describeTarget(target),
        field,
      });
    }
  }

  #markWriteFault(write: PendingWrite, error: unknown): void {
    if (write.session !== this.#session) return;
    for (const ref of this.#stripsForTarget(write.target)) {
      const state = this.#getStripState(ref.role, ref.strip);
      state.writeFault = write.kind;
      state.armed = false;
      this.#dropPendingByStrip(this.#stripKey(ref.role, ref.strip));
      this.#logger.warn("sync.write_fault", {
        role: state.role,
        strip: state.strip,
        target: describeTarget(write.target),
        field: write.kind,
        error,
      });
    }
  }

  #sendMotorForTarget(target: StripTarget, db: number): void {
    if ((this.#sendAux !== null) !== (target.kind === "send")) return;
    for (const ref of this.#stripsForTarget(target)) {
      const state = this.#getStripState(ref.role, ref.strip);
      if (!state.touched && state.armed && this.#motorAllowedFor(target) && !state.blocked) {
        this.#sendMotor(state, db);
      }
    }
  }

  #sendMotor(state: StripState, db: number): boolean {
    if (state.lastMotorRaw !== undefined) {
      const lastDb = DEFAULT_FADER_LAW.rawToDb(state.lastMotorRaw);
      if (Math.abs(lastDb - db) < this.#config.safety.feedbackEpsilonDb) return false;
    }
    const raw = DEFAULT_FADER_LAW.dbToRaw(db);
    const message = encodeFader(state.strip, raw);
    if (this.#midi.send(state.role, message)) {
      state.lastMotorRaw = raw;
      this.#logger.debug("sync.motor_sent", { role: state.role, strip: state.strip, db, raw });
      return true;
    }
    this.#logger.debug("sync.motor_send_failed", { role: state.role, strip: state.strip, db });
    return false;
  }

  #alignMotors(reason: string, enabled: boolean): void {
    if (!enabled || !this.#motorAlignmentAllowed()) return;
    let strips = 0;
    for (const state of this.#stripStates.values()) {
      if (this.#alignMotorForState(state)) strips += 1;
    }
    if (strips > 0) this.#logger.info("sync.motors_aligned", { reason, strips });
  }

  #alignMotorsForRole(role: SurfaceRole, reason: string): void {
    if (!this.#config.safety.alignMotorsOnStart || !this.#motorAlignmentAllowed()) return;
    let strips = 0;
    for (const state of this.#stripStates.values()) {
      if (state.role !== role) continue;
      if (this.#alignMotorForState(state)) strips += 1;
    }
    if (strips > 0) this.#logger.info("sync.motors_aligned", { reason, role, strips });
  }

  #motorAlignmentAllowed(): boolean {
    return (
      this.#arming.motors &&
      this.#arming.writes &&
      this.#fairlightConnected &&
      !this.#structureLocked &&
      !this.#identityLocked
    );
  }

  #alignMotorForState(state: StripState): boolean {
    if (state.touched || state.blocked || state.writeFault !== null) return false;
    const target = this.#activeTarget(state.role, state.strip);
    if (!target) return false;
    if (!this.#canWriteTarget(target)) return false;
    const level = this.#levelForTarget(target);
    if (level === null) return false;
    return this.#sendMotor(state, level);
  }

  #updateMuteLed(state: StripState, muted: boolean | null): void {
    if (muted === null) return;
    if (state.lastMuteLed === muted) return;
    if (this.#midi.send(state.role, encodeMuteLed(state.strip, muted))) {
      state.lastMuteLed = muted;
    }
  }

  #sendRingForTarget(target: StripTarget, pan: number): void {
    for (const ref of this.#stripsForTarget(target)) {
      const state = this.#getStripState(ref.role, ref.strip);
      this.#sendRing(state, pan);
    }
  }

  #sendRing(state: StripState, pan: number): boolean {
    if (this.#encoderMode(state.role) !== "pan") return false;
    if (state.strip >= 8) return false;
    const position = panToRing(pan);
    if (state.lastPanRing === position) return false;
    if (this.#midi.send(state.role, encodeEncoderRing(state.strip, ENCODER_RING_MODE, position))) {
      state.lastPanRing = position;
      return true;
    }
    return false;
  }

  #sendMeterForTarget(target: StripTarget, meterDb: number): void {
    const refs =
      target.kind === "send"
        ? this.#channelStrips.get(target.channel) ?? []
        : this.#stripsForTarget(target);
    for (const ref of refs) {
      const state = this.#getStripState(ref.role, ref.strip);
      this.#sendMeter(state, meterDb);
    }
  }

  #sendMeter(state: StripState, meterDb: number): boolean {
    if (!this.#metersEnabled(state.role)) return false;
    if (state.strip >= 8) return false;
    const segment = dbToMeterSegment(meterDb, -60, 0, 12);
    if (state.lastMeterSegment === segment) return false;
    if (this.#midi.send(state.role, encodeMeter(state.strip, segment))) {
      state.lastMeterSegment = segment;
      return true;
    }
    return false;
  }

  #repaintRingsForRole(role: SurfaceRole): void {
    if (this.#encoderMode(role) !== "pan") return;
    for (let strip = 0; strip < 8; strip += 1) {
      const state = this.#getStripState(role, strip);
      const target = this.#mapping.resolve(role, strip);
      const pan = target ? this.#stateForTarget(target)?.pan ?? null : null;
      state.lastPanRing = undefined;
      if (pan === null) {
        this.#midi.send(role, encodeEncoderRing(strip, ENCODER_RING_MODE, 0));
        state.lastPanRing = 0;
      } else {
        this.#sendRing(state, pan);
      }
    }
  }

  #repaintAllRings(): void {
    for (const role of this.#roles) this.#repaintRingsForRole(role);
  }

  #clearMetersForRole(role: SurfaceRole): void {
    if (!this.#metersEnabled(role)) return;
    for (let strip = 0; strip < 8; strip += 1) {
      const state = this.#getStripState(role, strip);
      if (state.lastMeterSegment === 0) continue;
      if (this.#midi.send(role, encodeMeter(strip, 0))) state.lastMeterSegment = 0;
    }
  }

  #clearAllMeters(): void {
    for (const role of this.#roles) this.#clearMetersForRole(role);
  }

  #updateAssignLeds(): void {
    const defaultAux = this.#config.mapping.sendsOnFader.enabled ? this.#config.mapping.sendsOnFader.busIndex : null;
    this.#midi.send(this.#mainRole, encodeLed(MCU_NOTE_SEND, defaultAux !== null && this.#sendAux === defaultAux));
    this.#midi.send(this.#mainRole, encodeLed(MCU_NOTE_PAN, this.#sendAux === null));
    for (const button of BUTTON_IDS) {
      const assignment = this.#config.mapping.buttonAssignments[button];
      let on = false;
      if (assignment?.type === "sends-on-fader") {
        on = assignment.auxIndex === this.#sendAux;
      } else if (assignment?.type === "monitor-dim") {
        on = this.#monitors.get(assignment.monitorIndex)?.dimmed === true;
      }
      this.#midi.send(this.#mainRole, encodeLed(buttonNote(button), on));
    }
  }

  #refreshMainDisplay(reason: string): void {
    // A disabled main unit has no output the bridge could address.
    if (!this.#mainDeviceEnabled) return;
    if (this.#mainDisplay.mode === "off" && this.#segmentValues === null) return;
    const cells = mainDisplayCells({
      config: this.#mainDisplay,
      connected: this.#fairlightConnected,
      sendAux: this.#sendAux,
      visibleChannels: this.#visibleChannels(this.#mainDisplay.scope),
      onAir: this.#onAir,
      meter: this.#mainDisplayMeter(),
      now: new Date(),
    });
    this.#writeMainDisplay(cells, reason);
  }

  #clearMainDisplay(reason: string): void {
    // Without a cached frame there is nothing the bridge knows it wrote. Retrying
    // here would also blank digits the user may have set by other means.
    if (this.#segmentValues === null) return;
    this.#writeMainDisplay(null, reason);
  }

  #writeMainDisplay(cells: readonly SegmentCell[] | null, reason: string): void {
    const target = cells ?? blankSegmentCells();
    const plan = segmentUpdatePlan(target, this.#segmentValues, MCU_SEGMENT_CC_TIME_BASE);
    if (plan.updates.length === 0) {
      this.#segmentValues = cells === null ? null : this.#segmentValues;
      return;
    }
    const values = this.#segmentValues ? [...this.#segmentValues] : plan.values.slice();
    let success = true;
    for (const update of plan.updates) {
      const sent = this.#midi.send(this.#mainRole, [
        MCU_STATUS_CONTROL_CHANGE,
        update.cc,
        update.value,
      ]);
      if (sent) values[update.index] = update.value;
      else success = false;
    }
    this.#segmentValues = success && cells !== null ? values : null;
    this.#logger.debug("sync.main_display_updated", {
      reason,
      mode: this.#mainDisplay.mode,
      scope: this.#mainDisplay.scope,
      digits: plan.updates.length,
      success,
    });
  }

  #refreshMeterDisplayForBus(bus: BusState, changed: BusField[]): void {
    const meter = this.#mainDisplay.meter;
    if (this.#mainDisplay.mode !== "meter" || !meter) return;
    if (meter.target.busType !== bus.type || meter.target.index !== bus.index) return;
    if (!changed.includes("meter") && !changed.includes("integrated")) return;
    this.#refreshMainDisplay("meter update");
  }

  #mainDisplayMeter(): MainDisplayMeterReading | null {
    const meter = this.#mainDisplay.meter;
    if (!meter) return null;
    const bus = this.#buses.get(busKey(meter.target.busType, meter.target.index));
    return {
      measurement: meter.measurement,
      value:
        meter.measurement === "loudness"
          ? (bus?.integratedLufs ?? null)
          : (bus?.meterDb ?? null),
    };
  }

  #visibleChannels(scope: MainDisplayScope): number[] {
    const roles = scope === "main" ? [this.#mainRole] : this.#roles;
    const channels: number[] = [];
    for (const role of roles) {
      for (let strip = 0; strip < 8; strip += 1) {
        const target = this.#mapping.resolve(role, strip);
        if (target?.kind === "channel") channels.push(target.channel);
      }
    }
    return channels;
  }

  #repaintAllLeds(): void {
    for (const role of this.#roles) this.#repaintLeds(role);
  }

  #repaintLeds(role: SurfaceRole): void {
    for (let strip = 0; strip < 8; strip += 1) {
      const target = this.#mapping.resolve(role, strip);
      const state = this.#getStripState(role, strip);
      const source = target ? this.#stateForTarget(target) : null;
      const desired = source?.muted === true;
      if (state.lastMuteLed === desired) continue;
      if (this.#midi.send(state.role, encodeMuteLed(strip, desired))) {
        state.lastMuteLed = desired;
      }
    }
  }

  #refreshDisplays(): void {
    for (const state of this.#stripStates.values()) this.#updateStripDisplay(state);
    for (const role of this.#roles) this.#refreshLcdColors(role);
  }

  #refreshDisplaysForRole(role: SurfaceRole): void {
    for (const state of this.#stripStates.values()) {
      if (state.role === role) this.#updateStripDisplay(state);
    }
    this.#refreshLcdColors(role);
  }

  #refreshDisplayForChannel(index: number): void {
    const roles = new Set<SurfaceRole>();
    for (const ref of this.#channelStrips.get(index) ?? []) {
      this.#updateStripDisplay(this.#getStripState(ref.role, ref.strip));
      roles.add(ref.role);
    }
    for (const role of roles) this.#refreshLcdColors(role);
  }

  #refreshDisplayForBus(type: BusType, index: number): void {
    const refs = this.#busStrips.get(keyForTarget({ kind: "bus", busType: type, index })) ?? [];
    const roles = new Set<SurfaceRole>();
    for (const ref of refs) {
      this.#updateStripDisplay(this.#getStripState(ref.role, ref.strip));
      roles.add(ref.role);
    }
    for (const role of roles) this.#refreshLcdColors(role);
  }

  #displayFor(role: SurfaceRole, strip: number) {
    const target = this.#mapping.resolve(role, strip);
    if (this.#sendAux !== null) {
      if (!target || target.kind !== "channel") {
        return { target: null, display: resolveLcdDisplay(this.#config.lcd, null) };
      }
      const auxIndex = this.#sendAux;
      const channel = this.#channels.get(target.channel);
      const send = channel?.sends[auxSendKey(auxIndex)];
      const hasSend = Boolean(send);
      const displayTarget = {
        kind: "channel" as const,
        index: target.channel,
        name: channel?.name ?? "",
      };
      let display = resolveLcdDisplay(this.#config.lcd, displayTarget, {
        levelDb: send?.levelDb ?? null,
        targetLabel: hasSend ? `AUX ${auxIndex}` : "NO SEND",
        unavailable: !hasSend,
      });
      if (!this.#lcdUsesRuntimeLine()) {
        display = {
          ...display,
          bottom: clampLcdText(hasSend ? `AUX ${auxIndex}` : "NO SEND"),
        };
      }
      return { target: hasSend ? this.#sendTargetForChannel(target.channel) : null, display };
    }
    const displayTarget =
      target === null
        ? null
        : target.kind === "channel"
          ? {
              kind: "channel" as const,
              index: target.channel,
              name: this.#channels.get(target.channel)?.name ?? "",
            }
          : {
              kind: "bus" as const,
              busType: target.busType,
              index: target.index,
              name: this.#buses.get(busKey(target.busType, target.index))?.name ?? "",
            };
    return {
      target,
      display: resolveLcdDisplay(this.#config.lcd, displayTarget, {
        levelDb: target ? this.#levelForTarget(target) : null,
      }),
    };
  }

  #lcdUsesRuntimeLine(): boolean {
    return [this.#config.lcd.line1, this.#config.lcd.line2].some(
      (mode) => mode === "value" || mode === "target",
    );
  }

  #lcdUsesValueLine(): boolean {
    return this.#config.lcd.line1 === "value" || this.#config.lcd.line2 === "value";
  }

  #refreshLcdColors(role: SurfaceRole): void {
    if (!this.#config.lcd.colorsEnabled) return;
    const colors: LcdColor[] = [];
    for (let strip = 0; strip < 8; strip += 1) {
      colors.push(this.#displayFor(role, strip).display.color);
    }
    this.#midi.send(role, encodeLcdStripColors(this.#lcdDevice(role), colors));
  }

  #lcdDevice(role: SurfaceRole): number {
    return role === this.#mainRole ? MCU_LCD_DEVICE_XTOUCH : MCU_LCD_DEVICE_EXTENDER;
  }

  #updateStripDisplay(state: StripState): void {
    if (state.strip >= 8) return;
    const { display } = this.#displayFor(state.role, state.strip);
    const device = this.#lcdDevice(state.role);
    this.#midi.send(state.role, encodeLcdStripText(device, state.strip, 0, display.top));
    this.#midi.send(state.role, encodeLcdStripText(device, state.strip, 1, display.bottom));
  }

  #enqueue(write: PendingWrite): void {
    const key = `${write.stripKey}:${write.kind}`;
    this.#pending.set(key, write);
    this.#logger.debug("sync.write_queued", {
      role: write.role,
      strip: write.strip,
      kind: write.kind,
      target: describeTarget(write.target),
      db: write.db,
      muted: write.muted,
    });
    this.#pumpWrites();
  }

  #pumpWrites(): void {
    if (this.#inFlight) return;
    if (this.#pending.size === 0) return;
    const now = Date.now();
    const wait = Math.max(0, this.#nextWriteAt - now);
    if (wait > 0) {
      if (!this.#writeTimer) {
        this.#writeTimer = setTimeout(() => {
          this.#writeTimer = undefined;
          this.#pumpWrites();
        }, wait);
      }
      return;
    }
    let first = this.#pending.entries().next();
    while (!first.done && this.#writeExpired(first.value[1])) {
      this.#logger.debug("sync.write_dropped_expired", {
        role: first.value[1].role,
        strip: first.value[1].strip,
        kind: first.value[1].kind,
        target: describeTarget(first.value[1].target),
        ageMs: Date.now() - first.value[1].enqueuedAt,
      });
      this.#pending.delete(first.value[0]);
      first = this.#pending.entries().next();
    }
    if (first.done) return;
    const [key, write] = first.value;
    this.#pending.delete(key);
    this.#inFlight = { ...write, startedAt: Date.now() };
    this.#nextWriteAt = Date.now() + Math.ceil(1000 / this.#config.safety.maxWritesPerSecond);
    void this.#executeWrite(this.#inFlight).finally(() => {
      this.#inFlight = null;
      this.#pumpWrites();
    });
  }

  async #executeWrite(write: InFlightWrite): Promise<void> {
    if (this.#writeExpired(write)) {
      this.#logger.debug("sync.write_dropped_expired", {
        role: write.role,
        strip: write.strip,
        kind: write.kind,
        target: describeTarget(write.target),
        ageMs: Date.now() - write.enqueuedAt,
      });
      return;
    }
    if (write.session !== this.#session) {
      this.#logger.debug("sync.write_dropped_stale_session", {
        kind: write.kind,
        target: describeTarget(write.target),
        writeSession: write.session,
        session: this.#session,
      });
      return;
    }
    if (!this.#fairlightConnected || !this.#fairlight.connected) {
      this.#logger.debug("sync.write_dropped_offline", { kind: write.kind, target: describeTarget(write.target) });
      return;
    }
    if (!this.#canWriteTarget(write.target)) {
      this.#logger.debug("sync.write_dropped_not_allowed", { kind: write.kind, target: describeTarget(write.target) });
      return;
    }
    try {
      if (write.kind === "level") {
        const db = write.db;
        if (db === undefined) return;
        if (write.target.kind === "channel") {
          const confirmed = await this.#fairlight.setChannelLevel(write.target.channel, db);
          if (!this.#writeStillApplies(write)) return;
          const channel = this.#channels.get(write.target.channel);
          if (channel) {
            channel.levelDb = confirmed;
            this.#sendMotorForTarget(write.target, confirmed);
          }
        } else if (write.target.kind === "send") {
          const confirmed = await this.#fairlight.setChannelSendLevel(write.target.channel, write.target.index, db);
          if (!this.#writeStillApplies(write)) return;
          const channel = this.#channels.get(write.target.channel);
          const send = channel?.sends[auxSendKey(write.target.index)];
          if (send) {
            send.levelDb = confirmed;
            this.#sendMotorForTarget(write.target, confirmed);
          }
        } else {
          const confirmed = await this.#fairlight.setBusLevel(write.target.busType, write.target.index, db);
          if (!this.#writeStillApplies(write)) return;
          const bus = this.#buses.get(busKey(write.target.busType, write.target.index));
          if (bus) {
            bus.levelDb = confirmed;
            this.#sendMotorForTarget(write.target, confirmed);
          }
        }
        this.#logger.debug("sync.level_written", {
          target: describeTarget(write.target),
          db,
          latencyMs: Date.now() - write.startedAt,
        });
      } else if (write.kind === "pan") {
        const pan = write.pan;
        if (pan === undefined) return;
        if (write.target.kind === "channel") {
          const confirmed = await this.#fairlight.setChannelPan(write.target.channel, pan);
          if (!this.#writeStillApplies(write)) return;
          const channel = this.#channels.get(write.target.channel);
          if (channel) channel.pan = confirmed;
          this.#sendRingForTarget(write.target, confirmed);
        } else if (write.target.kind === "bus") {
          const confirmed = await this.#fairlight.setBusPan(write.target.busType, write.target.index, pan);
          if (!this.#writeStillApplies(write)) return;
          const bus = this.#buses.get(busKey(write.target.busType, write.target.index));
          if (bus) bus.pan = confirmed;
          this.#sendRingForTarget(write.target, confirmed);
        }
        this.#logger.debug("sync.pan_written", {
          target: describeTarget(write.target),
          pan,
          latencyMs: Date.now() - write.startedAt,
        });
      } else {
        if (write.muted === undefined) return;
        if (write.target.kind === "channel") {
          const confirmed = await this.#fairlight.setChannelMute(write.target.channel, write.muted);
          if (!this.#writeStillApplies(write)) return;
          const channel = this.#channels.get(write.target.channel);
          if (channel) {
            channel.muted = confirmed;
            for (const ref of this.#channelStrips.get(write.target.channel) ?? []) {
              this.#updateMuteLed(this.#getStripState(ref.role, ref.strip), channel.muted);
            }
          }
        } else if (write.target.kind === "bus") {
          const confirmed = await this.#fairlight.setBusMute(write.target.busType, write.target.index, write.muted);
          if (!this.#writeStillApplies(write)) return;
          const bus = this.#buses.get(busKey(write.target.busType, write.target.index));
          if (bus) {
            bus.muted = confirmed;
            const refs = this.#busStrips.get(keyForTarget(write.target)) ?? [];
            for (const ref of refs) {
              this.#updateMuteLed(this.#getStripState(ref.role, ref.strip), bus.muted);
            }
          }
        }
        this.#logger.debug("sync.mute_written", {
          target: describeTarget(write.target),
          muted: write.muted,
          latencyMs: Date.now() - write.startedAt,
        });
      }
    } catch (error) {
      this.#logger.error("sync.write_failed", {
        kind: write.kind,
        target: describeTarget(write.target),
        error,
      });
      this.#markWriteFault(write, error);
    }
  }

  #writeExpired(write: PendingWrite): boolean {
    return Date.now() - write.enqueuedAt > this.#config.safety.writeExpiryMs;
  }

  #writeStillApplies(write: InFlightWrite): boolean {
    if (write.session !== this.#session) {
      this.#logger.warn("sync.write_confirmation_stale_session", {
        kind: write.kind,
        target: describeTarget(write.target),
      });
      return false;
    }
    const current = this.#activeTarget(write.role, write.strip);
    if (!current || keyForTarget(current) !== keyForTarget(write.target)) {
      this.#logger.warn("sync.write_confirmation_stale_mapping", {
        kind: write.kind,
        target: describeTarget(write.target),
        current: current ? describeTarget(current) : null,
      });
      return false;
    }
    return true;
  }

  #invalidateWrites(reason: string): void {
    if (this.#pending.size > 0) {
      this.#logger.debug("sync.pending_writes_dropped", { reason, count: this.#pending.size });
    }
    this.#pending.clear();
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = undefined;
    }
  }

  #dropPendingByStrip(stripKey: string): void {
    for (const [key, write] of this.#pending) {
      if (write.stripKey === stripKey) this.#pending.delete(key);
    }
  }

  #isLevelWritePending(state: StripState): boolean {
    const key = `${this.#stripKey(state.role, state.strip)}:level`;
    return this.#pending.has(key) || (this.#inFlight?.stripKey === this.#stripKey(state.role, state.strip) && this.#inFlight.kind === "level");
  }

  #activeTarget(role: SurfaceRole, strip: number): StripTarget | null {
    const base = this.#mapping.resolve(role, strip);
    if (this.#sendAux === null) return base;
    if (!base || base.kind !== "channel") return null;
    const auxIndex = this.#sendAux;
    const channel = this.#channels.get(base.channel);
    if (!channel?.sends[auxSendKey(auxIndex)]) return null;
    return { kind: "send", busType: "aux", index: auxIndex, channel: base.channel };
  }

  #sendTargetForChannel(channel: number): StripTarget | null {
    if (this.#sendAux === null) return null;
    const auxIndex = this.#sendAux;
    const state = this.#channels.get(channel);
    if (!state?.sends[auxSendKey(auxIndex)]) return null;
    return { kind: "send", busType: "aux", index: auxIndex, channel };
  }

  #canWriteTarget(target: StripTarget): boolean {
    if (!this.#arming.writes || this.#structureLocked) return false;
    if (target.kind === "channel") {
      return this.#config.safety.allowedWriteChannels.includes(target.channel);
    }
    if (target.kind === "send") {
      return this.#config.safety.allowedWriteChannels.includes(target.channel);
    }
    return this.#config.safety.allowedWriteBuses.includes(`${target.busType}:${target.index}`);
  }

  #motorAllowedFor(target: StripTarget): boolean {
    return this.#arming.motors && this.#arming.writes && this.#fairlightConnected && this.#canWriteTarget(target);
  }

  #stateForTarget(target: StripTarget): ChannelState | BusState | SendState | null {
    if (target.kind === "channel") return this.#channels.get(target.channel) ?? null;
    if (target.kind === "bus") return this.#buses.get(busKey(target.busType, target.index)) ?? null;
    return this.#channels.get(target.channel)?.sends[auxSendKey(target.index)] ?? null;
  }

  #levelForTarget(target: StripTarget): number | null {
    return this.#stateForTarget(target)?.levelDb ?? null;
  }

  #stripsForTarget(target: StripTarget): StripRef[] {
    if (target.kind === "channel") return this.#channelStrips.get(target.channel) ?? [];
    if (target.kind === "send") return this.#sendStrips.get(keyForTarget(target)) ?? [];
    return this.#busStrips.get(keyForTarget(target)) ?? [];
  }

  #rebuildBindingIndexes(): void {
    this.#channelStrips = new Map();
    this.#busStrips = new Map();
    this.#sendStrips = new Map();
    for (const state of this.#stripStates.values()) {
      const target = this.#mapping.resolve(state.role, state.strip);
      if (!target) continue;
      if (target.kind === "channel") {
        const list = this.#channelStrips.get(target.channel) ?? [];
        list.push({ role: state.role, strip: state.strip });
        this.#channelStrips.set(target.channel, list);
        const sendTarget = this.#sendTargetForChannel(target.channel);
        if (sendTarget) {
          const sendKey = keyForTarget(sendTarget);
          const sendList = this.#sendStrips.get(sendKey) ?? [];
          sendList.push({ role: state.role, strip: state.strip });
          this.#sendStrips.set(sendKey, sendList);
        }
      } else {
        const key = keyForTarget(target);
        const list = this.#busStrips.get(key) ?? [];
        list.push({ role: state.role, strip: state.strip });
        this.#busStrips.set(key, list);
      }
    }
  }

  #warnMissingBindings(): void {
    const missing: Array<{ role: SurfaceRole; strip: number; target: string }> = [];
    for (const state of this.#stripStates.values()) {
      const target = this.#mapping.resolve(state.role, state.strip);
      if (!target) continue;
      if (!this.#stateForTarget(target)) {
        missing.push({ role: state.role, strip: state.strip, target: describeTarget(target) });
      }
    }
    if (missing.length > 0) {
      this.#logger.warn("sync.mapped_targets_missing", { count: missing.length, missing });
    }
  }

  #ensureStripStates(): void {
    for (const role of this.#roles) {
      const maxStrip = role === this.#mainRole ? 8 : 7;
      for (let strip = 0; strip <= maxStrip; strip += 1) {
        const key = this.#stripKey(role, strip);
        if (!this.#stripStates.has(key)) {
          this.#stripStates.set(key, {
            role,
            strip,
            touched: false,
            armed: false,
            blocked: false,
            writeFault: null,
            lockedTarget: null,
            lastMotorRaw: undefined,
            lastMuteLed: undefined,
            lastPanRing: undefined,
            lastMeterSegment: undefined,
          });
        }
      }
    }
    this.#rebuildBindingIndexes();
  }

  #getStripState(role: SurfaceRole, strip: number): StripState {
    const key = this.#stripKey(role, strip);
    let state = this.#stripStates.get(key);
    if (!state) {
      state = {
        role,
        strip,
        touched: false,
        armed: false,
        blocked: false,
        writeFault: null,
        lockedTarget: null,
        lastMotorRaw: undefined,
        lastMuteLed: undefined,
        lastPanRing: undefined,
        lastMeterSegment: undefined,
      };
      this.#stripStates.set(key, state);
    }
    return state;
  }

  #stripKey(role: SurfaceRole, strip: number): string {
    return `${role}:${strip}`;
  }

  #logIgnored(state: StripState, reason: string): void {
    this.#logger.debug("sync.input_ignored", { role: state.role, strip: state.strip, reason });
  }
}
