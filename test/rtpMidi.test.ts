import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:net";

import { parseConfig } from "../src/config.js";
import {
  MidiListDecoder,
  decodeAppleMidiPacket,
  decodeRtpMidiPacket,
  encodeAppleMidiPacket,
  encodeRtpMidiPacket,
} from "../src/midi/appleMidi.js";
import { MidiDeviceManager } from "../src/midi/deviceManager.js";
import { MockRtpMidiPeer } from "../src/midi/mockRtpMidiPeer.js";
import { RtpMidiSession } from "../src/midi/rtpMidiSession.js";
import { VirtualMidiBackend } from "../src/midi/virtualBackend.js";
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

function nearPeer(options: { accept?: boolean } = {}): Promise<{ peer: MockRtpMidiPeer; port: number }> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryOnce = async (): Promise<void> => {
      attempts += 1;
      const port = await freePort();
      const peer = new MockRtpMidiPeer({ port, logger, reject: options.accept === false });
      try {
        await peer.start();
        resolve({ peer, port });
      } catch {
        await peer.stop().catch(() => undefined);
        if (attempts >= 20) reject(new Error("Could not bind a mock RTP-MIDI peer"));
        else void tryOnce();
      }
    };
    void tryOnce();
  });
}

function sessionFor(port: number, overrides: Record<string, unknown> = {}): RtpMidiSession {
  return new RtpMidiSession({
    host: "127.0.0.1",
    port,
    name: "Test Bridge",
    logger,
    inviteIntervalMs: 100,
    inviteAttempts: 6,
    retryDelayMs: 200,
    sessionTimeoutMs: 2000,
    syncIntervalMs: 500,
    tickMs: 20,
    ...overrides,
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

describe("AppleMIDI packet codec", () => {
  it("round-trips invitation, acceptance, termination and feedback packets", () => {
    const invitation = encodeAppleMidiPacket({
      command: "IN",
      version: 2,
      token: 0x11223344,
      ssrc: 0xaabbccdd,
      name: "Bridge",
    });
    const decoded = decodeAppleMidiPacket(invitation);
    assert.equal(decoded?.command, "IN");
    assert.equal(decoded?.version, 2);
    assert.equal(decoded?.token, 0x11223344);
    assert.equal(decoded?.ssrc, 0xaabbccdd);
    assert.equal(decoded?.name, "Bridge");

    const accepted = decodeAppleMidiPacket(
      encodeAppleMidiPacket({ command: "OK", version: 2, token: 1, ssrc: 2, name: "X-Touch" }),
    );
    assert.equal(accepted?.command, "OK");
    assert.equal(accepted?.name, "X-Touch");

    const feedback = decodeAppleMidiPacket(
      encodeAppleMidiPacket({ command: "RS", version: 2, token: 1, ssrc: 2, sequence: 4711 }),
    );
    assert.equal(feedback?.command, "RS");
    assert.equal(feedback?.sequence, 4711);

    const sync = decodeAppleMidiPacket(
      encodeAppleMidiPacket({ command: "CK", version: 2, token: 1, ssrc: 2, timestamps: [10n, 20n] }),
    );
    assert.equal(sync?.command, "CK");
    assert.equal(sync?.count, 1);
    assert.deepEqual(sync?.timestamps, [10n, 20n]);

    const end = decodeAppleMidiPacket(encodeAppleMidiPacket({ command: "BY", version: 2, token: 1, ssrc: 2 }));
    assert.equal(end?.command, "BY");
  });

  it("rejects packets with the wrong signature or too short", () => {
    assert.equal(decodeAppleMidiPacket(Buffer.alloc(3)), null);
    assert.equal(decodeAppleMidiPacket(Buffer.alloc(16)), null);
  });
});

describe("RTP-MIDI payload codec", () => {
  it("round-trips a fader message and a long LCD SysEx", () => {
    for (const message of [
      [0xe0, 0x00, 0x40],
      [0xf0, 0x00, 0x00, 0x66, 0x14, ...Array.from({ length: 12 }, (_, index) => 0x20 + index), 0xf7],
    ]) {
      const decoder = new MidiListDecoder();
      const packet = encodeRtpMidiPacket({ sequence: 7, timestamp: 1234, ssrc: 0x12345678, message });
      const decoded = decodeRtpMidiPacket(packet, decoder);
      assert.equal(decoded?.sequence, 7);
      assert.equal(decoded?.timestamp, 1234);
      assert.equal(decoded?.ssrc, 0x12345678);
      assert.deepEqual(decoded?.messages, [message]);
    }
  });

  it("decodes running status, delta times and segmented SysEx", () => {
    // J=0, B=1, LEN=...; list: note on, delta 0, running-status note on, delta 0, SysEx start, ...
    const list = [
      0x90, 0x3c, 0x7f,
      0x00, 0x3e, 0x70,
      0x00, 0xf0, 0x7e, 0x7f, 0x06, 0x01,
    ];
    const header = Buffer.from([0x80 | ((list.length >> 8) & 0x0f), list.length & 0xff]);
    const rtp = Buffer.alloc(14 + list.length);
    rtp[0] = 0x80;
    rtp[1] = 0x61;
    rtp.writeUInt16BE(1, 2);
    rtp.writeUInt32BE(0, 4);
    rtp.writeUInt32BE(9, 8);
    header.copy(rtp, 12);
    Buffer.from(list).copy(rtp, 14);

    const decoder = new MidiListDecoder();
    const first = decodeRtpMidiPacket(rtp, decoder);
    assert.deepEqual(first?.messages, [
      [0x90, 0x3c, 0x7f],
      [0x90, 0x3e, 0x70],
    ]);

    // Continuation segment of the same SysEx, preceded by a zero delta time.
    const rest = [0x00, 0x04, 0x01, 0xf7];
    const header2 = Buffer.from([rest.length]);
    const second = Buffer.alloc(13 + rest.length);
    second[0] = 0x80;
    second[1] = 0x61;
    second.writeUInt16BE(2, 2);
    second.writeUInt32BE(0, 4);
    second.writeUInt32BE(9, 8);
    header2.copy(second, 12);
    Buffer.from(rest).copy(second, 13);
    const decoded = decodeRtpMidiPacket(second, decoder);
    assert.deepEqual(decoded?.messages, [[0xf0, 0x7e, 0x7f, 0x06, 0x01, 0x04, 0x01, 0xf7]]);
  });
});

describe("AppleMIDI session over UDP", () => {
  it("establishes a session, sends and receives MIDI in both directions", { timeout: 20_000 }, async () => {
    const { peer, port } = await nearPeer();
    const session = sessionFor(port);
    const receivedByPeer: number[][] = [];
    const receivedBySession: number[][] = [];
    peer.onEvent((event) => {
      if (event.type === "midi") receivedByPeer.push(event.message);
    });
    session.onEvent((event) => {
      if (event.type === "midi") receivedBySession.push(event.message);
    });
    try {
      assert.equal(session.send([0xe0, 0x00, 0x40]), false);
      session.start();
      await waitFor(() => session.online && peer.online, "session handshake", 5000);

      const fader = [0xe1, 0x00, 0x40];
      assert.equal(session.send(fader), true);
      await waitFor(() => receivedByPeer.length === 1, "peer to receive the fader", 2000);
      assert.deepEqual(receivedByPeer[0], fader);

      const lcd = [0xf0, 0x00, 0x00, 0x66, 0x14, ...Array.from({ length: 12 }, () => 0x41), 0xf7];
      assert.equal(peer.send(lcd), true);
      assert.equal(peer.send([0x90, 0x10, 0x7f]), true);
      await waitFor(() => receivedBySession.length === 2, "session to receive both messages", 2000);
      assert.deepEqual(receivedBySession[0], lcd);
      assert.deepEqual(receivedBySession[1], [0x90, 0x10, 0x7f]);
    } finally {
      await session.stop();
      await peer.stop();
    }
  });

  it("reports a rejected invitation and never goes online", { timeout: 10_000 }, async () => {
    const { peer, port } = await nearPeer({ accept: false });
    const session = sessionFor(port);
    const states: string[] = [];
    session.onEvent((event) => {
      if (event.type === "offline") states.push(event.reason);
    });
    try {
      session.start();
      await waitFor(() => states.some((reason) => /rejected/.test(reason)), "rejection reason");
      assert.equal(session.online, false);
      assert.match(session.reason ?? "", /rejected/);
    } finally {
      await session.stop();
      await peer.stop();
    }
  });

  it("ends the session when the peer goes away and reconnects after it returns", { timeout: 20_000 }, async () => {
    const { peer, port } = await nearPeer();
    const session = sessionFor(port, { sessionTimeoutMs: 500, inviteAttempts: 4 });
    const events: string[] = [];
    session.onEvent((event) => events.push(event.type));
    try {
      session.start();
      await waitFor(() => session.online, "first connection", 5000);
      await peer.stop();
      await waitFor(() => !session.online && events.includes("offline"), "offline after peer stop", 4000);
      const restarted = new MockRtpMidiPeer({ port, logger });
      await restarted.start();
      try {
        await waitFor(() => session.online, "reconnect after peer restart", 8000);
      } finally {
        await restarted.stop();
      }
    } finally {
      await session.stop();
      await peer.stop();
    }
  });
});

describe("MIDI device manager network transport", () => {
  it("reports a network device online and routes MIDI through the session", { timeout: 20_000 }, async () => {
    const { peer, port } = await nearPeer();
    const config = parseConfig({
      midi: {
        rescanIntervalMs: 250,
        devices: [
          {
            role: "main",
            kind: "main",
            transport: "network",
            network: { host: "127.0.0.1", port },
          },
        ],
      },
      mapping: { master: { enabled: false } },
      logLevel: "error",
    });
    const backend = new VirtualMidiBackend();
    const manager = new MidiDeviceManager(config.midi, backend, logger, {
      createRtpMidiSession: (device) =>
        sessionFor(port, { name: device.name ?? "test" }),
    });
    const events: string[] = [];
    const received: number[][] = [];
    manager.onEvent((event) => {
      events.push(event.type === "midi" ? "midi" : event.type);
      if (event.type === "midi") received.push(event.message);
    });
    peer.onEvent((event) => {
      if (event.type === "midi") received.push(event.message);
    });
    try {
      manager.start();
      await waitFor(() => manager.statuses()[0]?.online === true, "network device online", 5000);
      const status = manager.statuses()[0];
      assert.equal(status?.inputName, `127.0.0.1:${port}`);
      assert.equal(status?.inputIndex, null);
      assert.equal(status?.reason, null);

      assert.equal(manager.send("main", [0xe0, 0x00, 0x40]), true);
      await waitFor(() => received.length === 1, "peer to receive manager output", 2000);

      peer.send([0x90, 0x10, 0x7f]);
      await waitFor(() => received.length === 2, "manager to forward peer input", 2000);

      await peer.stop();
      await waitFor(() => manager.statuses()[0]?.online === false, "network device offline", 5000);
      assert.equal(manager.send("main", [0xe0, 0x00, 0x40]), false);
    } finally {
      manager.stop();
      await peer.stop();
    }
  });
});
