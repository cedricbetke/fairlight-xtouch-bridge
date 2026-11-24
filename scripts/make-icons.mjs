// Generates the app and tray icons without third-party dependencies.
// Run with: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4);
  }

  blend(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size || a <= 0) return;
    const index = (y * this.size + x) * 4;
    const alpha = a / 255;
    const destination = this.data;
    destination[index] = Math.round(r * alpha + destination[index] * (1 - alpha));
    destination[index + 1] = Math.round(g * alpha + destination[index + 1] * (1 - alpha));
    destination[index + 2] = Math.round(b * alpha + destination[index + 2] * (1 - alpha));
    destination[index + 3] = Math.min(255, Math.round(a + destination[index + 3] * (1 - alpha)));
  }

  fill(color) {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) this.blend(x, y, color);
    }
  }

  roundedRect(x0, y0, width, height, radius, color) {
    const x1 = x0 + width;
    const y1 = y0 + height;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
        const dx = x + 0.5 < x0 + radius ? x0 + radius - (x + 0.5) : x + 0.5 > x1 - radius ? x + 0.5 - (x1 - radius) : 0;
        const dy = y + 0.5 < y0 + radius ? y0 + radius - (y + 0.5) : y + 0.5 > y1 - radius ? y + 0.5 - (y1 - radius) : 0;
        if (dx * dx + dy * dy <= radius * radius) this.blend(x, y, color);
      }
    }
  }

  toPng() {
    return encodePng(this.size, this.size, this.data);
  }
}

function appIcon(size) {
  const canvas = new Canvas(size);
  const scale = size / 1024;
  // Rounded slate tile with a soft vertical gradient.
  for (let y = 0; y < size; y += 1) {
    const t = y / size;
    const r = Math.round(12 + 8 * t);
    const g = Math.round(18 + 12 * t);
    const b = Math.round(24 + 16 * t);
    for (let x = 0; x < size; x += 1) {
      const margin = 40 * scale;
      const radius = 190 * scale;
      const dx = Math.max(margin + radius - (x + 0.5), 0, x + 0.5 - (size - margin - radius));
      const dy = Math.max(margin + radius - (y + 0.5), 0, y + 0.5 - (size - margin - radius));
      if (dx * dx + dy * dy <= radius * radius) canvas.blend(x, y, [r, g, b, 255]);
    }
  }
  const tracks = [
    { x: 268, top: 250, knob: 0.62 },
    { x: 420, top: 250, knob: 0.24 },
    { x: 572, top: 250, knob: 0.78 },
    { x: 724, top: 250, knob: 0.42 },
  ];
  const trackWidth = 46 * scale;
  for (const track of tracks) {
    canvas.roundedRect(track.x * scale, track.top * scale, trackWidth, 520 * scale, 23 * scale, [58, 71, 84, 255]);
    const knobY = track.top + (520 - 96) * track.knob;
    canvas.roundedRect(
      (track.x - 22) * scale,
      knobY * scale,
      (trackWidth + 44) * scale,
      96 * scale,
      30 * scale,
      [232, 163, 61, 255],
    );
    canvas.roundedRect(
      (track.x - 22) * scale + 10 * scale,
      knobY * scale + 20 * scale,
      (trackWidth + 44) * scale - 20 * scale,
      20 * scale,
      10 * scale,
      [255, 214, 145, 255],
    );
  }
  return canvas.toPng();
}

function trayIcon(size, template) {
  const canvas = new Canvas(size);
  const scale = size / 16;
  const color = template ? [0, 0, 0, 255] : [222, 231, 238, 255];
  const track = template ? [0, 0, 0, 70] : [140, 156, 170, 255];
  const geometry = [
    { x: 2.5, knob: 0.35 },
    { x: 7.0, knob: 0.68 },
    { x: 11.5, knob: 0.48 },
  ];
  for (const entry of geometry) {
    canvas.roundedRect(entry.x * scale, 2 * scale, 1.4 * scale, 12 * scale, 0.7 * scale, track);
    const knobY = 2 + (12 - 3.6) * entry.knob;
    canvas.roundedRect((entry.x - 0.9) * scale, knobY * scale, 3.2 * scale, 3.6 * scale, 1.2 * scale, color);
  }
  return canvas.toPng();
}

mkdirSync(assets, { recursive: true });
writeFileSync(join(assets, "icon.png"), appIcon(1024));
writeFileSync(join(assets, "tray.png"), trayIcon(32, false));
writeFileSync(join(assets, "trayTemplate.png"), trayIcon(16, true));
writeFileSync(join(assets, "trayTemplate@2x.png"), trayIcon(32, true));
console.log("Icons written to assets/");
