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

export type MockRtpMidiPeerEvent =
  | { type: "online" }
  | { type: "offline"; reason: string }
  | { type: "midi"; message: number[] };

export interface MockRtpMidiPeerOptions {
  /** Control port. The peer also listens on this port plus one for RTP-MIDI data. */
  port: number;
  name?: string;
  logger: Logger;
  /** Reject invitations to simulate a device that refuses a second session. */
  reject?: boolean;
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
  } catch {}
}

/**
 * A small AppleMIDI responder that behaves like an X-Touch in network MC mode.
 * It accepts invitations on the control and data ports and exchanges RTP-MIDI.
 */
export class MockRtpMidiPeer {
  readonly #options: MockRtpMidiPeerOptions;
  readonly #logger: Logger;
  readonly #listeners = new Set<(event: MockRtpMidiPeerEvent) => void>();
  readonly #decoder = new MidiListDecoder();
  readonly #ssrc = Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
  #control: Socket | null = null;
  #data: Socket | null = null;
  #boundPort = 0;
  #online = false;
  #peerControl: { address: string; port: number } | null = null;
  #peerData: { address: string; port: number } | null = null;
  #sequence = Math.floor(Math.random() * 0x10000);
  #epoch = Date.now();
  #stopped = true;

  constructor(options: MockRtpMidiPeerOptions) {
    this.#options = options;
    this.#logger = options.logger.child({ component: "mock-rtp-midi", port: options.port });
  }

  get port(): number {
    return this.#boundPort;
  }

  get dataPort(): number {
    return this.#boundPort + 1;
  }

  get online(): boolean {
    return this.#online;
  }

  onEvent(listener: (event: MockRtpMidiPeerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    const control = createSocket("udp4");
    const data = createSocket("udp4");
    try {
      await bindSocket(control, this.#options.port);
      const address = control.address();
      const port = typeof address === "object" ? address.port : 0;
      if (port <= 0 || port >= 65535) throw new Error("invalid mock RTP-MIDI port");
      await bindSocket(data, port + 1);
      this.#control = control;
      this.#data = data;
      this.#boundPort = port;
      this.#stopped = false;
      control.on("message", (buffer, rinfo) => this.#handleControl(buffer, rinfo));
      data.on("message", (buffer, rinfo) => this.#handleData(buffer, rinfo));
      this.#logger.debug("mock_rtp_midi.listening", { controlPort: port, dataPort: port + 1 });
    } catch (error) {
      closeSocket(control);
      closeSocket(data);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#online = false;
    closeSocket(this.#control);
    closeSocket(this.#data);
    this.#control = null;
    this.#data = null;
    this.#peerControl = null;
    this.#peerData = null;
    this.#decoder.reset();
  }

  send(message: number[]): boolean {
    if (!this.#online || !this.#data || !this.#peerData) return false;
    try {
      const packet = encodeRtpMidiPacket({
        sequence: this.#sequence,
        timestamp: Number(BigInt(Date.now() - this.#epoch) * 10n) >>> 0,
        ssrc: this.#ssrc,
        message,
      });
      this.#sequence = (this.#sequence + 1) & 0xffff;
      this.#data.send(packet, this.#peerData.port, this.#peerData.address);
      return true;
    } catch (error) {
      this.#logger.warn("mock_rtp_midi.send_failed", { error });
      return false;
    }
  }

  #handleControl(buffer: Buffer, rinfo: RemoteInfo): void {
    const packet = decodeAppleMidiPacket(buffer);
    if (!packet) return;
    if (packet.command === "IN") {
      if (this.#options.reject) {
        this.#control?.send(
          encodeAppleMidiPacket({
            command: "NO",
            version: APPLE_MIDI_VERSION,
            token: packet.token,
            ssrc: this.#ssrc,
          }),
          rinfo.port,
          rinfo.address,
        );
        return;
      }
      this.#peerControl = { address: rinfo.address, port: rinfo.port };
      this.#control?.send(
        encodeAppleMidiPacket({
          command: "OK",
          version: APPLE_MIDI_VERSION,
          token: packet.token,
          ssrc: this.#ssrc,
          name: this.#options.name ?? "Mock X-Touch",
        }),
        rinfo.port,
        rinfo.address,
      );
      return;
    }
    this.#handlePacket(packet, "control", rinfo);
  }
  #handleData(buffer: Buffer, rinfo: RemoteInfo): void {
    const packet = decodeAppleMidiPacket(buffer);
    if (packet) {
      if (packet.command === "IN") {
        if (this.#options.reject) {
          this.#data?.send(
            encodeAppleMidiPacket({
              command: "NO",
              version: APPLE_MIDI_VERSION,
              token: packet.token,
              ssrc: this.#ssrc,
            }),
            rinfo.port,
            rinfo.address,
          );
          return;
        }
        this.#peerData = { address: rinfo.address, port: rinfo.port };
        this.#data?.send(
          encodeAppleMidiPacket({
            command: "OK",
            version: APPLE_MIDI_VERSION,
            token: packet.token,
            ssrc: this.#ssrc,
            name: this.#options.name ?? "Mock X-Touch",
          }),
          rinfo.port,
          rinfo.address,
        );
        if (!this.#online) {
          this.#online = true;
          this.#emit({ type: "online" });
        }
        return;
      }
      this.#handlePacket(packet, "data", rinfo);
      return;
    }
    const rtp = decodeRtpMidiPacket(buffer, this.#decoder);
    if (!rtp) return;
    for (const message of rtp.messages) this.#emit({ type: "midi", message });
  }

  #handlePacket(packet: AppleMidiPacket, side: "control" | "data", rinfo: RemoteInfo): void {
    if (packet.command === "CK") {
      if (side !== "data" || !packet.timestamps?.length) return;
      const timestamps = [...packet.timestamps, BigInt(Date.now() - this.#epoch) * 10n];
      this.#data?.send(
        encodeAppleMidiPacket({
          command: "CK",
          version: APPLE_MIDI_VERSION,
          token: packet.token,
          ssrc: this.#ssrc,
          timestamps,
        }),
        rinfo.port,
        rinfo.address,
      );
      return;
    }
    if (packet.command === "BY") {
      this.#online = false;
      this.#emit({ type: "offline", reason: "peer ended the session" });
    }
  }

  #emit(event: MockRtpMidiPeerEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.#logger.error("mock_rtp_midi.listener_failed", { error });
      }
    }
  }
}
