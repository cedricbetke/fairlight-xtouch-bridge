import type { SurfaceRole } from "../config.js";
import {
  encodeFader,
  encodeLed,
  decodeMcuMessage,
  MCU_CC_ENCODER_BASE,
  MCU_CC_VPOT_RING_BASE,
  MCU_NOTE_BANK_LEFT,
  MCU_NOTE_BANK_RIGHT,
  MCU_NOTE_ENCODER_PUSH_BASE,
  MCU_NOTE_MUTE_BASE,
  MCU_NOTE_PAN,
  MCU_NOTE_SEND,
  MCU_NOTE_TOUCH_BASE,
  MCU_STATUS_CHANNEL_PRESSURE,
  MCU_STATUS_CONTROL_CHANGE,
  MCU_STATUS_NOTE_ON,
} from "../mcu/codec.js";
import { buttonNote, type ButtonId } from "../mcu/buttons.js";
import { DEFAULT_FADER_LAW } from "../mcu/faderLaw.js";
import type { VirtualMidiBackend } from "../midi/virtualBackend.js";

export interface VirtualSurfaceDevice {
  role: SurfaceRole;
  inputName: string;
  outputName: string;
}

export class VirtualMcuSurface {
  readonly #backend: VirtualMidiBackend;
  readonly #devices: Map<SurfaceRole, VirtualSurfaceDevice>;

  constructor(backend: VirtualMidiBackend, devices: VirtualSurfaceDevice[]) {
    this.#backend = backend;
    this.#devices = new Map(devices.map((device) => [device.role, device]));
    for (const device of devices) {
      backend.addDevice({ inputName: device.inputName, outputName: device.outputName });
    }
  }

  deviceName(role: SurfaceRole): string {
    const device = this.#device(role);
    return device.inputName;
  }

  touch(role: SurfaceRole, strip: number, touched: boolean): void {
    this.#send(role, [MCU_STATUS_NOTE_ON, MCU_NOTE_TOUCH_BASE + strip, touched ? 0x7f : 0x00]);
  }

  moveFader(role: SurfaceRole, strip: number, db: number): void {
    this.#send(role, encodeFader(strip, DEFAULT_FADER_LAW.dbToRaw(db)));
  }

  pressMute(role: SurfaceRole, strip: number): void {
    const note = MCU_NOTE_MUTE_BASE + strip;
    this.#send(role, encodeLed(note, true));
    this.#send(role, encodeLed(note, false));
  }

  pressBank(role: SurfaceRole, direction: "left" | "right"): void {
    const note = direction === "left" ? MCU_NOTE_BANK_LEFT : MCU_NOTE_BANK_RIGHT;
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x7f]);
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x00]);
  }

  pressAssign(role: SurfaceRole, assign: "send" | "pan"): void {
    const note = assign === "send" ? MCU_NOTE_SEND : MCU_NOTE_PAN;
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x7f]);
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x00]);
  }

  pressFunction(role: SurfaceRole, button: ButtonId): void {
    const note = buttonNote(button);
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x7f]);
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x00]);
  }

  turnEncoder(role: SurfaceRole, strip: number, delta: number): void {
    const magnitude = Math.min(0x3f, Math.abs(Math.trunc(delta)));
    const value = delta < 0 ? (0x40 | magnitude) : magnitude;
    this.#send(role, [MCU_STATUS_CONTROL_CHANGE, MCU_CC_ENCODER_BASE + strip, value]);
  }

  pressEncoder(role: SurfaceRole, strip: number): void {
    const note = MCU_NOTE_ENCODER_PUSH_BASE + strip;
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x7f]);
    this.#send(role, [MCU_STATUS_NOTE_ON, note, 0x00]);
  }

  panRing(role: SurfaceRole, strip: number): number | null {
    const messages = this.sentMessages(role);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message[0] !== MCU_STATUS_CONTROL_CHANGE) continue;
      if (message[1] !== MCU_CC_VPOT_RING_BASE + strip) continue;
      return (message[2] ?? 0) & 0x0f;
    }
    return null;
  }

  meterSegment(role: SurfaceRole, strip: number): number | null {
    const messages = this.sentMessages(role);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message[0] !== MCU_STATUS_CHANNEL_PRESSURE) continue;
      if (((message[1] ?? 0) >> 4) !== strip) continue;
      return (message[1] ?? 0) & 0x0f;
    }
    return null;
  }

  sentMessages(role: SurfaceRole): number[][] {
    return this.#backend.sentMessages(this.#device(role).outputName);
  }

  clearSent(role?: SurfaceRole): void {
    if (role) {
      this.#backend.clearSent(this.#device(role).outputName);
      return;
    }
    for (const device of this.#devices.values()) this.#backend.clearSent(device.outputName);
  }

  lastMotorRaw(role: SurfaceRole, strip: number): number | null {
    const messages = this.sentMessages(role);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const decoded = decodeMcuMessage(messages[index] ?? []);
      if (decoded?.type === "fader" && decoded.strip === strip) return decoded.raw;
    }
    return null;
  }

  motorMessages(role: SurfaceRole, strip?: number): number[][] {
    return this.sentMessages(role).filter((message) => {
      const decoded = decodeMcuMessage(message);
      return decoded?.type === "fader" && (strip === undefined || decoded.strip === strip);
    });
  }

  muteLed(role: SurfaceRole, strip: number): boolean | null {
    const note = MCU_NOTE_MUTE_BASE + strip;
    const messages = this.sentMessages(role);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message[0] !== MCU_STATUS_NOTE_ON || message[1] !== note) continue;
      return (message[2] ?? 0) > 0;
    }
    return null;
  }

  functionLed(role: SurfaceRole, button: ButtonId): boolean | null {
    const note = buttonNote(button);
    const messages = this.sentMessages(role);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message[0] !== MCU_STATUS_NOTE_ON || message[1] !== note) continue;
      return (message[2] ?? 0) > 0;
    }
    return null;
  }

  remove(role: SurfaceRole): void {
    this.#backend.removeDevice(this.#device(role).inputName);
  }

  restore(role: SurfaceRole): void {
    this.#backend.addDeviceBack(this.#device(role).inputName);
  }

  #send(role: SurfaceRole, message: number[]): void {
    this.#backend.injectInput(this.#device(role).inputName, message);
  }

  #device(role: SurfaceRole): VirtualSurfaceDevice {
    const device = this.#devices.get(role);
    if (!device) throw new Error(`No virtual surface configured for ${role}`);
    return device;
  }
}

export async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 3000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
