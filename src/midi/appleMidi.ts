/**
 * AppleMIDI session packets and the RTP-MIDI payload format (RFC 6295).
 *
 * Only the parts the bridge needs are implemented: session invitations and
 * termination, clock sync packets, and RTP-MIDI packets without a recovery
 * journal. Incoming journals are ignored, which the Apple protocol permits.
 */

export const APPLE_MIDI_SIGNATURE = 0xffff;
export const APPLE_MIDI_VERSION = 2;
export const RTP_MIDI_PAYLOAD_TYPE = 0x61;
export const RTP_MIDI_CLOCK_HZ = 10_000;

export const APPLE_MIDI_COMMANDS = ["IN", "OK", "NO", "BY", "CK", "RS", "RL"] as const;
export type AppleMidiCommand = (typeof APPLE_MIDI_COMMANDS)[number];

const COMMAND_VALUES: Record<AppleMidiCommand, number> = {
  IN: 0x494e,
  OK: 0x4f4b,
  NO: 0x4e4f,
  BY: 0x4259,
  CK: 0x434b,
  RS: 0x5253,
  RL: 0x524c,
};

export interface AppleMidiPacket {
  command: AppleMidiCommand;
  version: number;
  token: number;
  ssrc: number;
  name?: string;
  /** Clock sync packets: number of valid timestamps minus one. */
  count?: number;
  /** Clock sync timestamps in 100 µs units. */
  timestamps?: bigint[];
  /** Receiver feedback: the last received RTP sequence number. */
  sequence?: number;
  /** Bitrate receive limit in bytes per second. */
  bitrateLimit?: number;
}

function decodeCommand(value: number): AppleMidiCommand | null {
  for (const [command, code] of Object.entries(COMMAND_VALUES) as Array<[AppleMidiCommand, number]>) {
    if (code === value) return command;
  }
  return null;
}

export function decodeAppleMidiPacket(buffer: Buffer): AppleMidiPacket | null {
  if (buffer.length < 16) return null;
  if (buffer.readUInt16BE(0) !== APPLE_MIDI_SIGNATURE) return null;
  const command = decodeCommand(buffer.readUInt16BE(2));
  if (!command) return null;
  const version = buffer.readUInt32BE(4);
  const token = buffer.readUInt32BE(8);
  const ssrc = buffer.readUInt32BE(12);
  const packet: AppleMidiPacket = { command, version, token, ssrc };

  if (command === "IN" || command === "OK" || command === "NO" || command === "BY") {
    if (buffer.length > 16) {
      const nameBytes = buffer.subarray(16);
      const end = nameBytes.indexOf(0);
      const name = (end === -1 ? nameBytes : nameBytes.subarray(0, end)).toString("utf8");
      if (name !== "") packet.name = name;
    }
    return packet;
  }

  if (command === "CK") {
    if (buffer.length < 20) return null;
    const count = buffer[16] ?? 0;
    packet.count = count;
    const timestamps: bigint[] = [];
    let offset = 20;
    for (let index = 0; index <= count; index += 1) {
      if (offset + 8 > buffer.length) return null;
      timestamps.push(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    packet.timestamps = timestamps;
    return packet;
  }

  if (command === "RS") {
    if (buffer.length < 20) return null;
    packet.sequence = buffer.readUInt32BE(16);
    return packet;
  }

  if (command === "RL") {
    if (buffer.length < 20) return null;
    packet.bitrateLimit = buffer.readUInt32BE(16);
    return packet;
  }

  return packet;
}

export function encodeAppleMidiPacket(packet: AppleMidiPacket): Buffer {
  let extra = 0;
  if (packet.command === "IN" || packet.command === "OK" || packet.command === "BY" || packet.command === "NO") {
    if (packet.name) extra = Buffer.byteLength(packet.name, "utf8") + 1;
  } else if (packet.command === "CK") {
    extra = 4 + (packet.timestamps?.length ?? 1) * 8;
  } else {
    extra = 4;
  }
  const buffer = Buffer.alloc(16 + extra);
  buffer.writeUInt16BE(APPLE_MIDI_SIGNATURE, 0);
  buffer.writeUInt16BE(COMMAND_VALUES[packet.command], 2);
  buffer.writeUInt32BE(packet.version || APPLE_MIDI_VERSION, 4);
  buffer.writeUInt32BE(packet.token >>> 0, 8);
  buffer.writeUInt32BE(packet.ssrc >>> 0, 12);

  if (packet.command === "IN" || packet.command === "OK" || packet.command === "BY" || packet.command === "NO") {
    if (packet.name) buffer.write(packet.name, 16, "utf8");
    return buffer;
  }
  if (packet.command === "CK") {
    const timestamps = packet.timestamps ?? [];
    buffer[16] = Math.max(0, timestamps.length - 1);
    let offset = 20;
    for (const timestamp of timestamps) {
      buffer.writeBigUInt64BE(BigInt.asUintN(64, timestamp), offset);
      offset += 8;
    }
    return buffer;
  }
  if (packet.command === "RS") {
    buffer.writeUInt32BE((packet.sequence ?? 0) >>> 0, 16);
    return buffer;
  }
  buffer.writeUInt32BE((packet.bitrateLimit ?? 0) >>> 0, 16);
  return buffer;
}

export interface RtpMidiPacket {
  sequence: number;
  timestamp: number;
  ssrc: number;
  messages: number[][];
}

function commandDataLength(status: number): number {
  const kind = status & 0xf0;
  if (kind === 0xc0 || kind === 0xd0) return 1;
  if (kind === 0x80 || kind === 0x90 || kind === 0xa0 || kind === 0xb0 || kind === 0xe0) return 2;
  return 0;
}

function skipDeltaTime(bytes: readonly number[], index: number): number {
  let offset = index;
  for (let count = 0; count < 4; count += 1) {
    if (offset >= bytes.length) return offset;
    const value = bytes[offset] ?? 0;
    offset += 1;
    if ((value & 0x80) === 0) return offset;
  }
  return offset;
}

class MidiListDecoder {
  #running: number | null = null;
  #sysex: number[] | null = null;

  reset(): void {
    this.#running = null;
    this.#sysex = null;
  }

  /** Decodes one MIDI list. Segmented SysEx state survives across packets. */
  decode(list: readonly number[], zeroDeltaStart: boolean): number[][] {
    const messages: number[][] = [];
    let index = 0;
    let first = true;

    while (index < list.length) {
      if (this.#sysex !== null) {
        const sysex = this.#sysex;
        index = skipDeltaTime(list, index);
        let finished = false;
        while (index < list.length) {
          const byte = list[index] ?? 0;
          index += 1;
          sysex.push(byte);
          if (byte === 0xf7) {
            finished = true;
            break;
          }
        }
        if (finished) {
          messages.push(sysex);
          this.#sysex = null;
        }
        continue;
      }

      if (!first || zeroDeltaStart) {
        const next = skipDeltaTime(list, index);
        if (next === index) return messages;
        index = next;
      }
      first = false;
      if (index >= list.length) break;

      const byte = list[index] ?? 0;
      let status: number;
      if (byte >= 0x80) {
        status = byte;
        index += 1;
      } else if (this.#running !== null) {
        status = this.#running;
      } else {
        index += 1;
        continue;
      }

      if (status < 0xf0) {
        const dataLength = commandDataLength(status);
        if (dataLength === 0 || index + dataLength > list.length) return messages;
        const message = [status, ...list.slice(index, index + dataLength)];
        index += dataLength;
        this.#running = status;
        messages.push(message);
        continue;
      }

      if (status === 0xf0) {
        const sysex = [0xf0];
        this.#running = null;
        let finished = false;
        while (index < list.length) {
          const value = list[index] ?? 0;
          index += 1;
          sysex.push(value);
          if (value === 0xf7) {
            finished = true;
            break;
          }
        }
        if (finished) messages.push(sysex);
        else this.#sysex = sysex;
        continue;
      }

      if (status === 0xf7) {
        index += 1;
        continue;
      }

      const dataLength = status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0;
      if (index + dataLength > list.length) break;
      const message = [status, ...list.slice(index, index + dataLength)];
      index += dataLength;
      if (status < 0xf8) this.#running = null;
      messages.push(message);
    }
    return messages;
  }
}

const defaultDecoder = new MidiListDecoder();

export function decodeRtpMidiPacket(
  buffer: Buffer,
  decoder: MidiListDecoder = defaultDecoder,
): RtpMidiPacket | null {
  if (buffer.length < 13) return null;
  if ((buffer[0] ?? 0) >> 6 !== 2) return null;
  const csrcCount = (buffer[0] ?? 0) & 0x0f;
  const headerLength = 12 + csrcCount * 4;
  if (buffer.length <= headerLength) return null;
  if (((buffer[1] ?? 0) & 0x7f) !== RTP_MIDI_PAYLOAD_TYPE) return null;

  const sequence = buffer.readUInt16BE(2);
  const timestamp = buffer.readUInt32BE(4);
  const ssrc = buffer.readUInt32BE(8);
  const header = buffer[headerLength] ?? 0;
  const longHeader = (header & 0x80) !== 0;
  const hasJournal = (header & 0x40) !== 0;
  const zeroDeltaStart = (header & 0x20) !== 0;
  const listLength = longHeader
    ? (((header & 0x0f) << 8) | (buffer[headerLength + 1] ?? 0))
    : header & 0x0f;
  const listOffset = headerLength + (longHeader ? 2 : 1);
  if (listLength === 0) return { sequence, timestamp, ssrc, messages: [] };
  if (listOffset + listLength > buffer.length) return null;
  const list = Array.from(buffer.subarray(listOffset, listOffset + listLength));
  if (hasJournal) {
    // Journal contents are not needed for control-surface traffic.
  }
  const messages = decoder.decode(list, zeroDeltaStart);
  return { sequence, timestamp, ssrc, messages };
}

export function encodeRtpMidiPacket(options: {
  sequence: number;
  timestamp: number;
  ssrc: number;
  message: readonly number[];
}): Buffer {
  const message = options.message;
  const longHeader = message.length > 15;
  if (message.length > 4095) {
    throw new Error(`RTP-MIDI message is too long: ${message.length} bytes`);
  }
  const payloadHeaderLength = longHeader ? 2 : 1;
  const buffer = Buffer.alloc(12 + payloadHeaderLength + message.length);
  buffer[0] = 0x80;
  buffer[1] = RTP_MIDI_PAYLOAD_TYPE;
  buffer.writeUInt16BE(options.sequence & 0xffff, 2);
  buffer.writeUInt32BE(options.timestamp >>> 0, 4);
  buffer.writeUInt32BE(options.ssrc >>> 0, 8);
  if (longHeader) {
    buffer[12] = 0x80 | ((message.length >> 8) & 0x0f);
    buffer[13] = message.length & 0xff;
    Buffer.from(message).copy(buffer, 14);
  } else {
    buffer[12] = message.length & 0x0f;
    Buffer.from(message).copy(buffer, 13);
  }
  return buffer;
}

export { MidiListDecoder };
