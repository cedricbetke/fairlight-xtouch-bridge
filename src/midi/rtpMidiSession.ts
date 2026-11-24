import { createSocket, type RemoteInfo, type Socket } from "node:dgram";

import type { Logger } from "../logger.js";
import {
  APPLE_MIDI_VERSION,
  MidiListDecoder,
  decodeAppleMidiPacket,
  decodeRtpMidiPacket,
  encodeAppleMidiPacket,
  encodeRtpMidiPacket,
  type AppleMidiPacket,
} from "./appleMidi.js";

export type RtpMidiSessionEvent =
  | { type: "online" }
  | { type: "offline"; reason: string }
  | { type: "midi"; message: number[] };

export interface RtpMidiSessionOptions {
  host: string;
  /** Control port. The data port is this port plus one, as defined by AppleMIDI. */
  port: number;
  name: string;
  logger: Logger;
  inviteIntervalMs?: number;
  inviteAttempts?: number;
  retryDelayMs?: number;
  sessionTimeoutMs?: number;
  syncIntervalMs?: number;
  tickMs?: number;
}

export interface RtpMidiSessionLike {
  readonly online: boolean;
  readonly reason: string | null;
  start(): void;
  stop(): Promise<void>;
  send(message: number[]): boolean;
  onEvent(listener: (event: RtpMidiSessionEvent) => void): () => void;
}

const DEFAULT_OPTIONS = {
  inviteIntervalMs: 1000,
  inviteAttempts: 12,
  retryDelayMs: 2000,
  sessionTimeoutMs: 30_000,
  syncIntervalMs: 10_000,
  tickMs: 250,
};

function randomUint32(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

function bindSocket(socket: Socket, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      socket.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind(port);
  });
}

function closeSocket(socket: Socket | null): void {
  if (!socket) return;
  try {
    socket.close();
  } catch {
    // Already closed or never bound.
  }
}

export class RtpMidiSession implements RtpMidiSessionLike {
  readonly #options: Required<Omit<RtpMidiSessionOptions, "logger">>;
  readonly #logger: Logger;
  readonly #listeners = new Set<(event: RtpMidiSessionEvent) => void>();
  readonly #decoder = new MidiListDecoder();
  readonly #token = randomUint32();
  readonly #ssrc = randomUint32();
  #control: Socket | null = null;
  #data: Socket | null = null;
  #binding: Promise<boolean> | null = null;
  #timer: NodeJS.Timeout | undefined;
  #stopped = true;
  #online = false;
  #reason: string | null = null;
  #controlReady = false;
  #dataReady = false;
  #inviteAttempts = 0;
  #nextInviteAt = 0;
  #nextStartAt = 0;
  #lastPeerPacket = 0;
  #lastSync = 0;
  #sequence = Math.floor(Math.random() * 0x10000);
  #epoch = Date.now();

  constructor(options: RtpMidiSessionOptions) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    this.#logger = options.logger.child({ component: "rtp-midi", host: options.host, port: options.port });
  }

  get online(): boolean {
    return this.#online;
  }

  get reason(): string | null {
    return this.#reason;
  }

  onEvent(listener: (event: RtpMidiSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#nextStartAt = 0;
    this.#resetHandshake();
    this.#timer = setInterval(() => {
      void this.#tick();
    }, this.#options.tickMs);
    this.#timer.unref();
    void this.#tick();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#controlReady || this.#dataReady) {
      this.#sendApple(this.#control, "BY", this.#options.port);
      this.#sendApple(this.#data, "BY", this.#options.port + 1);
    }
    this.#online = false;
    this.#controlReady = false;
    this.#dataReady = false;
    this.#reason = "stopped";
    closeSocket(this.#control);
    closeSocket(this.#data);
    this.#control = null;
    this.#data = null;
  }

  send(message: number[]): boolean {
    if (!this.#online || !this.#data) return false;
    if (message.length === 0) return false;
    try {
      const packet = encodeRtpMidiPacket({
        sequence: this.#sequence,
        timestamp: this.#timestamp(),
        ssrc: this.#ssrc,
        message,
      });
      this.#sequence = (this.#sequence + 1) & 0xffff;
      this.#data.send(packet, this.#options.port + 1, this.#options.host);
      return true;
    } catch (error) {
      this.#logger.error("rtp_midi.send_failed", { error });
      return false;
    }
  }

  async #tick(): Promise<void> {
    if (this.#stopped) return;
    if (!this.#control || !this.#data) {
      if (this.#binding) return;
      this.#binding = this.#bind().finally(() => {
        this.#binding = null;
      });
      await this.#binding;
      return;
    }

    const now = Date.now();
    if (now < this.#nextStartAt) return;

    if (!this.#controlReady) {
      if (now < this.#nextInviteAt) return;
      if (this.#inviteAttempts >= this.#options.inviteAttempts) {
        this.#fail(`no control-port response from ${this.#options.host}:${this.#options.port}`);
        return;
      }
      this.#inviteAttempts += 1;
      this.#nextInviteAt = now + this.#options.inviteIntervalMs;
      this.#sendApple(this.#control, "IN", this.#options.port);
      return;
    }

    if (!this.#dataReady) {
      if (now < this.#nextInviteAt) return;
      if (this.#inviteAttempts >= this.#options.inviteAttempts) {
        this.#fail(`no data-port response from ${this.#options.host}:${this.#options.port + 1}`);
        return;
      }
      this.#inviteAttempts += 1;
      this.#nextInviteAt = now + this.#options.inviteIntervalMs;
      this.#sendApple(this.#data, "IN", this.#options.port + 1);
      return;
    }

    if (now - this.#lastPeerPacket > this.#options.sessionTimeoutMs) {
      this.#fail(`no traffic from ${this.#options.host} for ${Math.round(this.#options.sessionTimeoutMs / 1000)} s`);
      return;
    }

    if (now - this.#lastSync >= this.#options.syncIntervalMs) {
      this.#lastSync = now;
      this.#sendSync(now);
    }
  }

  async #bind(): Promise<boolean> {
    for (let attempt = 0; attempt < 20 && !this.#stopped; attempt += 1) {
      const control = createSocket("udp4");
      const data = createSocket("udp4");
      try {
        await bindSocket(control, 0);
        const address = control.address();
        const controlPort = typeof address === "object" ? address.port : 0;
        if (controlPort <= 0 || controlPort >= 65535) throw new Error("invalid control port");
        await bindSocket(data, controlPort + 1);
        this.#control = control;
        this.#data = data;
        control.on("message", (buffer, rinfo) => this.#handleControl(buffer, rinfo));
        data.on("message", (buffer, rinfo) => this.#handleData(buffer, rinfo));
        control.on("error", (error) => this.#handleSocketError("control", error));
        data.on("error", (error) => this.#handleSocketError("data", error));
        this.#logger.info("rtp_midi.bound", { controlPort, dataPort: controlPort + 1 });
        return true;
      } catch (error) {
        closeSocket(control);
        closeSocket(data);
        this.#logger.debug("rtp_midi.bind_retry", { attempt, error });
      }
    }
    if (!this.#stopped) {
      this.#reason = "no free UDP port pair for the RTP-MIDI session";
      this.#logger.error("rtp_midi.bind_failed", {});
      this.#emit({ type: "offline", reason: this.#reason });
      this.#nextStartAt = Date.now() + this.#options.retryDelayMs;
    }
    return false;
  }

  #handleSocketError(side: "control" | "data", error: unknown): void {
    this.#logger.warn("rtp_midi.socket_error", { side, error });
    if (this.#online) this.#fail(`UDP ${side} socket error`);
  }

  #handleControl(buffer: Buffer, rinfo: RemoteInfo): void {
    if (this.#stopped) return;
    const packet = decodeAppleMidiPacket(buffer);
    if (!packet) return;
    this.#lastPeerPacket = Date.now();
    this.#handleSessionPacket(packet, "control", rinfo);
  }

  #handleData(buffer: Buffer, rinfo: RemoteInfo): void {
    if (this.#stopped) return;
    const control = decodeAppleMidiPacket(buffer);
    if (control) {
      this.#lastPeerPacket = Date.now();
      this.#handleSessionPacket(control, "data", rinfo);
      return;
    }
    const rtp = decodeRtpMidiPacket(buffer, this.#decoder);
    if (!rtp) return;
    this.#lastPeerPacket = Date.now();
    for (const message of rtp.messages) {
      this.#emit({ type: "midi", message });
    }
  }

  #handleSessionPacket(packet: AppleMidiPacket, side: "control" | "data", rinfo: RemoteInfo): void {
    if (packet.token !== this.#token) {
      if (packet.command !== "BY") return;
    }
    switch (packet.command) {
      case "OK":
        if (side === "control") {
          if (!this.#controlReady) {
            this.#controlReady = true;
            this.#inviteAttempts = 0;
            this.#nextInviteAt = 0;
            this.#logger.info("rtp_midi.control_accepted", { peer: `${rinfo.address}:${rinfo.port}` });
          }
        } else if (!this.#dataReady) {
          this.#dataReady = true;
          this.#inviteAttempts = 0;
          this.#lastPeerPacket = Date.now();
          this.#lastSync = 0;
          this.#setOnline();
        }
        return;
      case "NO":
        this.#fail(`invitation rejected by ${rinfo.address}:${rinfo.port}`);
        return;
      case "BY":
        this.#fail(`peer ${rinfo.address} ended the session`);
        return;
      case "CK":
        if (packet.timestamps && packet.timestamps.length > 0 && packet.count === 0) {
          this.#sendSyncReply(packet.timestamps[0] ?? 0n);
        }
        return;
      case "RS":
      case "RL":
      case "IN":
      default:
        return;
    }
  }

  #sendSyncReply(peerTimestamp: bigint): void {
    if (!this.#data) return;
    const packet = encodeAppleMidiPacket({
      command: "CK",
      version: APPLE_MIDI_VERSION,
      token: this.#token,
      ssrc: this.#ssrc,
      timestamps: [peerTimestamp, this.#now100us()],
    });
    this.#data.send(packet, this.#options.port + 1, this.#options.host);
  }

  #sendSync(now: number): void {
    if (!this.#data) return;
    this.#lastSync = now;
    const packet = encodeAppleMidiPacket({
      command: "CK",
      version: APPLE_MIDI_VERSION,
      token: this.#token,
      ssrc: this.#ssrc,
      timestamps: [this.#now100us()],
    });
    this.#data.send(packet, this.#options.port + 1, this.#options.host);
  }

  #sendApple(socket: Socket | null, command: "IN" | "BY", port: number): void {
    if (!socket) return;
    const packet = encodeAppleMidiPacket({
      command,
      version: APPLE_MIDI_VERSION,
      token: this.#token,
      ssrc: this.#ssrc,
      name: command === "IN" ? this.#options.name : undefined,
    });
    try {
      socket.send(packet, port, this.#options.host);
    } catch (error) {
      this.#logger.debug("rtp_midi.control_send_failed", { command, error });
    }
  }

  #setOnline(): void {
    if (this.#online) return;
    this.#online = true;
    this.#reason = null;
    this.#logger.info("rtp_midi.online", { host: this.#options.host, port: this.#options.port });
    this.#emit({ type: "online" });
  }

  #fail(reason: string): void {
    const wasOnline = this.#online;
    this.#online = false;
    this.#controlReady = false;
    this.#dataReady = false;
    this.#reason = reason;
    this.#inviteAttempts = 0;
    this.#nextInviteAt = 0;
    this.#nextStartAt = Date.now() + this.#options.retryDelayMs;
    this.#decoder.reset();
    if (wasOnline) this.#logger.warn("rtp_midi.offline", { reason });
    else this.#logger.debug("rtp_midi.not_connected", { reason });
    this.#emit({ type: "offline", reason });
  }

  #resetHandshake(): void {
    this.#controlReady = false;
    this.#dataReady = false;
    this.#inviteAttempts = 0;
    this.#nextInviteAt = 0;
    this.#decoder.reset();
  }

  #now100us(): bigint {
    return BigInt(Math.floor((Date.now() - this.#epoch) * 10));
  }

  #timestamp(): number {
    return Number(this.#now100us() & 0xffff_ffffn) >>> 0;
  }

  #emit(event: RtpMidiSessionEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.#logger.error("rtp_midi.listener_failed", { error });
      }
    }
  }
}

export interface RtpMidiProbeResult {
  ok: boolean;
  reason: string | null;
}

/**
 * Opens a short-lived session to check that an X-Touch accepts invitations and
 * answers the clock sync. It sends no MIDI data and closes with BY.
 */
export async function probeRtpMidi(options: {
  host: string;
  port: number;
  timeoutMs: number;
  logger: Logger;
}): Promise<RtpMidiProbeResult> {
  if (options.port >= 65535) {
    return { ok: false, reason: "the control port must be below 65535 to leave room for the data port" };
  }
  const session = new RtpMidiSession({
    host: options.host,
    port: options.port,
    name: "Fairlight X-Touch Bridge (probe)",
    logger: options.logger,
    inviteIntervalMs: Math.min(1000, Math.max(100, Math.floor(options.timeoutMs / 4))),
    inviteAttempts: 4,
    retryDelayMs: options.timeoutMs,
    sessionTimeoutMs: options.timeoutMs,
    syncIntervalMs: 1000,
    tickMs: 50,
  });
  let settled = false;
  return new Promise<RtpMidiProbeResult>((resolve) => {    const finish = (result: RtpMidiProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void session.stop();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: `no answer within ${options.timeoutMs} ms` }), options.timeoutMs);
    session.onEvent((event) => {
      if (event.type === "online") finish({ ok: true, reason: null });
      else if (event.type === "offline") finish({ ok: false, reason: event.reason });
    });
    try {
      session.start();
    } catch (error) {
      finish({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  });
}
