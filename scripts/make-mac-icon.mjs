/**
 * Generates packaging/icon.png (1024×1024) — the macOS app icon source —
 * with zero image dependencies: pixels are composed in a Float buffer and
 * written out as a PNG via node:zlib. Rerun after tweaking, then rebuild the
 * .icns (scripts/make-mac-icns.sh does both).
 *
 * Design: the app's "knowledge nebula" — a dark rounded-square field with a
 * teal/violet nebula glow and a small constellation of connected document
 * nodes, echoing the in-app 3D graph.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SIZE = 1024;
const CORNER_RADIUS = 232; // Big Sur-style rounded square

// --- scene definition -------------------------------------------------------

// Node layout: hand-placed constellation, roughly the app's force-graph look.
// [x, y, radius, r, g, b]
const NODES = [
  [512, 468, 46, 130, 235, 255], // bright center
  [312, 330, 26, 120, 200, 255],
  [716, 314, 22, 190, 150, 255],
  [768, 552, 24, 130, 235, 255],
  [614, 726, 28, 190, 150, 255],
  [372, 700, 22, 120, 200, 255],
  [232, 528, 20, 150, 220, 255],
];
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [1, 6],
  [5, 6],
  [3, 4],
];

// Deterministic PRNG so the starfield is stable between runs.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260725);
const STARS = Array.from({ length: 140 }, () => [
  rand() * SIZE,
  rand() * SIZE,
  0.6 + rand() * 1.6,
  0.25 + rand() * 0.55,
]);

// --- helpers ---------------------------------------------------------------

function roundedRectCoverage(x, y) {
  const r = CORNER_RADIUS;
  const cx = Math.max(r, Math.min(SIZE - r, x));
  const cy = Math.max(r, Math.min(SIZE - r, y));
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, r - d + 0.5)); // 1px antialiased edge
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// --- render ----------------------------------------------------------------

const pixels = new Uint8Array(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cover = roundedRectCoverage(x, y);
    const offset = (y * SIZE + x) * 4;
    if (cover === 0) continue;

    // Background: deep navy, subtly brighter toward the upper center.
    const bgT = Math.hypot(x - 512, y - 380) / 900;
    let r = 9 + (1 - bgT) * 8;
    let g = 20 + (1 - bgT) * 14;
    let b = 36 + (1 - bgT) * 22;

    // Nebula glows: additive soft radial blobs (teal, violet, faint magenta).
    const glows = [
      [430, 400, 430, 8, 42, 58],
      [680, 560, 380, 34, 16, 60],
      [340, 680, 300, 40, 12, 44],
    ];
    for (const [gx, gy, gr, cr, cg, cb] of glows) {
      const d = Math.hypot(x - gx, y - gy) / gr;
      if (d < 1) {
        const k = (1 - d) ** 2;
        r += cr * k;
        g += cg * k;
        b += cb * k;
      }
    }

    // Stars.
    for (const [sx, sy, sr, sa] of STARS) {
      const d = Math.hypot(x - sx, y - sy);
      if (d < sr + 1.5) {
        const k = Math.max(0, 1 - d / (sr + 1.5)) * sa;
        r += 200 * k;
        g += 220 * k;
        b += 255 * k;
      }
    }

    // Edges: thin luminous lines with a soft halo.
    for (const [ai, bi] of EDGES) {
      const [ax, ay] = NODES[ai];
      const [bx, by] = NODES[bi];
      const d = distToSegment(x, y, ax, ay, bx, by);
      if (d < 10) {
        const core = Math.max(0, 1 - d / 3.4);
        const halo = Math.max(0, 1 - d / 10) * 0.22;
        const k = Math.min(1, core + halo) * 0.85;
        r += 90 * k;
        g += 190 * k;
        b += 235 * k;
      }
    }

    // Nodes: bright core + bloom, drawn over edges.
    for (const [nx, ny, nr, cr, cg, cb] of NODES) {
      const d = Math.hypot(x - nx, y - ny);
      const bloom = nr * 2.6;
      if (d < bloom) {
        const halo = Math.max(0, 1 - d / bloom) ** 2 * 0.55;
        const core = Math.max(0, Math.min(1, nr - d + 0.5));
        const white = Math.max(0, Math.min(1, nr * 0.45 - d + 0.5));
        r = r * (1 - core) + cr * core + halo * cr * 0.9 + white * (255 - cr);
        g = g * (1 - core) + cg * core + halo * cg * 0.9 + white * (255 - cg);
        b = b * (1 - core) + cb * core + halo * cb * 0.9 + white * (255 - cb);
      }
    }

    pixels[offset] = Math.min(255, Math.round(r));
    pixels[offset + 1] = Math.min(255, Math.round(g));
    pixels[offset + 2] = Math.min(255, Math.round(b));
    pixels[offset + 3] = Math.round(255 * cover);
  }
}

// --- PNG encode ------------------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crcTable = chunk.table ?? (chunk.table = buildCrcTable());
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4).forEach((v, i) => {
    raw[y * (SIZE * 4 + 1) + 1 + i] = v;
  });
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packaging', 'icon.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
