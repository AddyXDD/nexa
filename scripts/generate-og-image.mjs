/**
 * Generates `public/og.png` — the 1200×630 social card referenced by the
 * Open Graph and Twitter tags.
 *
 * Written as a plain Node script with no image dependencies (the project has
 * none, and a screenshot tool would be a large addition for one asset): the
 * Nexa mark is rasterised from the same geometry as `public/logo.svg` and the
 * accent stroke beneath it reuses the landing hero's underline curve, so the
 * card stays on-brand without shipping a binary nobody can regenerate.
 *
 *   node scripts/generate-og-image.mjs            # writes public/og.png
 *   node scripts/generate-og-image.mjs --preview  # also prints ASCII proof
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1200;
const HEIGHT = 630;
/** Supersampling factor; averaged down at the end for clean edges. */
const SS = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "og.png");

const bw = WIDTH * SS;
const bh = HEIGHT * SS;
const buf = new Uint8ClampedArray(bw * bh * 3);

/* ------------------------------------------------------------ primitives */

function blend(x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= bw || y >= bh) return;
  const i = (y * bw + x) * 3;
  buf[i] += (r - buf[i]) * a;
  buf[i + 1] += (g - buf[i + 1]) * a;
  buf[i + 2] += (b - buf[i + 2]) * a;
}

function hex(value) {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Even-odd scanline fill. `color` receives final-space coordinates. */
function fillPolygon(points, color) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY * SS));
  const y1 = Math.min(bh - 1, Math.ceil(maxY * SS));

  for (let y = y0; y <= y1; y++) {
    const scan = (y + 0.5) / SS;
    const crossings = [];
    for (let i = 0; i < points.length; i++) {
      const [xa, ya] = points[i];
      const [xb, yb] = points[(i + 1) % points.length];
      if (ya === yb) continue;
      if (scan >= Math.min(ya, yb) && scan < Math.max(ya, yb)) {
        crossings.push(xa + ((scan - ya) / (yb - ya)) * (xb - xa));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil(crossings[i] * SS));
      const to = Math.min(bw - 1, Math.floor(crossings[i + 1] * SS));
      for (let x = from; x <= to; x++) {
        const [r, g, b] = color((x + 0.5) / SS, scan);
        blend(x, y, r, g, b, 1);
      }
    }
  }
}

/** Quarter-circle arc, flattened, in the mark's 512-unit coordinate space. */
function arc(cx, cy, r, fromDeg, toDeg, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const rad = (t * Math.PI) / 180;
    pts.push([cx + r * Math.cos(rad), cy + r * Math.sin(rad)]);
  }
  return pts;
}

function cubic(p0, c1, c2, p1, steps = 80) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return pts;
}

/** Distance-feathered stroke around a flattened polyline. */
function stroke(points, halfWidth, color) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = halfWidth + 2;
  const x0 = Math.max(0, Math.floor((minX - pad) * SS));
  const x1 = Math.min(bw - 1, Math.ceil((maxX + pad) * SS));
  const y0 = Math.max(0, Math.floor((minY - pad) * SS));
  const y1 = Math.min(bh - 1, Math.ceil((maxY + pad) * SS));

  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) / SS;
    for (let x = x0; x <= x1; x++) {
      const px = (x + 0.5) / SS;
      let best = Infinity;
      for (let i = 0; i + 1 < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        const d = Math.hypot(px - cx, py - cy);
        if (d < best) best = d;
      }
      if (best > halfWidth + 0.8) continue;
      const a = best <= halfWidth - 0.8 ? 1 : (halfWidth + 0.8 - best) / 1.6;
      const [r, g, b] = color(px, py);
      blend(x, y, r, g, b, a);
    }
  }
}

/* ------------------------------------------------------------ background */

const PAPER = hex("#f4f4f5");
const ACCENT = hex("#7c8cf0");
const ACCENT_STOPS = [hex("#ffffff"), hex("#c6d1f6"), hex("#8b9cf0"), hex("#6d80e8")];

function accentAt(t) {
  const scaled = Math.max(0, Math.min(0.9999, t)) * (ACCENT_STOPS.length - 1);
  const i = Math.floor(scaled);
  return mix(ACCENT_STOPS[i], ACCENT_STOPS[i + 1], scaled - i);
}

// Deep ink centre falling to near-black, matching the app's dark surfaces.
const centreGlow = hex("#1d1f24");
const edge = hex("#0a0b0d");
for (let y = 0; y < bh; y++) {
  for (let x = 0; x < bw; x++) {
    const fx = (x + 0.5) / bw;
    const fy = (y + 0.5) / bh;
    const d = Math.hypot((fx - 0.5) / 0.78, (fy - 0.46) / 0.95);
    const t = Math.min(1, d);
    const [r, g, b] = mix(centreGlow, edge, t * t);
    const i = (y * bw + x) * 3;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
}

// Hairline grid, one final-space pixel wide.
const grid = hex("#f4f4f5");
for (let gx = 0; gx <= WIDTH; gx += 72) {
  for (let y = 0; y < bh; y++) {
    for (let s = 0; s < SS; s++) blend(gx * SS + s, y, grid[0], grid[1], grid[2], 0.05);
  }
}
for (let gy = 0; gy <= HEIGHT; gy += 72) {
  for (let x = 0; x < bw; x++) {
    for (let s = 0; s < SS; s++) blend(x, gy * SS + s, grid[0], grid[1], grid[2], 0.05);
  }
}

/* ------------------------------------------------------------------ mark */

// Same geometry as public/logo.svg (512-unit artboard), drawn centred.
const SCALE = 260 / 252;
const CX = WIDTH / 2;
const CY = 292;
const toCanvas = ([x, y]) => [CX + (x - 256) * SCALE, CY + (y - 258) * SCALE];

const barLeft = [
  [144, 132],
  [188, 132],
  [188, 384],
  [160, 384],
  ...arc(160, 368, 16, 90, 180),
].map(toCanvas);

const barMiddle = [
  [188, 132],
  [232, 132],
  [368, 384],
  [324, 384],
].map(toCanvas);

const barRight = [
  [324, 132],
  [350, 132],
  ...arc(350, 150, 18, -90, 0),
  [368, 340],
  [324, 258],
].map(toCanvas);

fillPolygon(barLeft, () => PAPER);
fillPolygon(barMiddle, () => PAPER);
// The right bar carries the logo's sapphire gradient: white at the top of the
// bar to #6d80e8 at the bottom. 162 and 376.6 are the canvas Y of the mark's
// y=132 and y=340 edges after the transform above.
fillPolygon(barRight, (_x, y) => accentAt((y - 162) / (376.6 - 162)));

// The hero's hand-drawn underline, blown up beneath the mark.
const underline = [
  ...cubic([2, 7], [46, 1.5], [92, 9], [132, 4.5]),
  ...cubic([132, 4.5], [172, 0], [182, 3], [198, 6.5]),
].map(([x, y]) => [450 + x * 1.5, 470 + (y - 5) * 1.5]);
stroke(underline, 3, () => ACCENT);

/* --------------------------------------------------------------- encode */

function downsample() {
  const out = Buffer.alloc(WIDTH * HEIGHT * 3);
  const area = SS * SS;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * bw + (x * SS + sx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = (y * WIDTH + x) * 3;
      out[o] = Math.round(r / area);
      out[o + 1] = Math.round(g / area);
      out[o + 2] = Math.round(b / area);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typed, data])), 0);
  return Buffer.concat([length, typed, data, crc]);
}

function encodePng(pixels) {
  const stride = WIDTH * 3;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = encodePng(downsample());
writeFileSync(OUT, png);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${WIDTH}×${HEIGHT}, ${png.length} bytes`);

if (process.argv.includes("--preview")) {
  const chars = " .:-=+*#%@";
  const cols = 78;
  const rows = 26;
  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < cols; col++) {
      line += chars[
        Math.min(
          chars.length - 1,
          Math.floor((lumaAt(col / cols, row / rows) / 255) * chars.length),
        )
      ];
    }
    console.log(line);
  }
}

function lumaAt(fx, fy) {
  const x = Math.min(WIDTH - 1, Math.floor(fx * WIDTH));
  const y = Math.min(HEIGHT - 1, Math.floor(fy * HEIGHT));
  let best = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const i = ((y * SS + sy) * bw + (x * SS + sx)) * 3;
      const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      if (l > best) best = l;
    }
  }
  return best;
}
