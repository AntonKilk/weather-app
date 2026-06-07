#!/usr/bin/env node
// PWA icon generator (STORY-006).
//
// Renders the project's icon set into `public/` using only Node built-ins
// (no `sharp`, no `canvas`, no third-party assets — per CLAUDE.md's
// "avoid adding dependencies" stance and the issue's "no third-party assets
// with licensing limits" requirement).
//
// Outputs (all committed to git):
//   - public/pwa-192.png             192x192 PNG, Android/Chrome install
//   - public/pwa-512.png             512x512 PNG, marked maskable in manifest
//   - public/apple-touch-icon-180.png 180x180 PNG, iOS home-screen
//   - public/favicon.svg             vector favicon
//
// Re-run with: `npm run gen:icons`. Output is deterministic.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');

// Brand palette — kept in sync with src/ui/styles.css.
const BG = [0x0b, 0x17, 0x26]; // --bg
const SUN = [0xf5, 0xc4, 0x53]; // --accent-warm
const CLOUD = [0xd9, 0xe2, 0xf0]; // --accent-cool

// ---------------------------------------------------------------------------
// PNG encoder — hand-rolled, RGBA8.
// ---------------------------------------------------------------------------

// CRC32 table (RFC 1952).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      // ^ unsigned right-shift keeps c in uint32 territory
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function encodePng(width, height, rgba) {
  // PNG signature.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: 13 bytes.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type: 6 = truecolor + alpha
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // IDAT: scanline-filtered (filter 0 = None) raw pixels, then deflate.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter byte
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Glyph drawing — sun behind a cloud, on the brand background.
// All coordinates are normalised to [0, 1] and scaled per icon size.
// ---------------------------------------------------------------------------

function setPx(buf, w, x, y, rgb, a = 255) {
  const ix = (y * w + x) * 4;
  // Source-over alpha composite onto whatever is already there.
  const srcA = a / 255;
  const dstA = buf[ix + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  for (let c = 0; c < 3; c += 1) {
    const src = rgb[c];
    const dst = buf[ix + c];
    buf[ix + c] = Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
  }
  buf[ix + 3] = Math.round(outA * 255);
}

// Soft-edged filled circle. `cx`,`cy`,`r` in pixels.
function drawCircle(buf, w, h, cx, cy, r, rgb) {
  const r2 = r * r;
  const aaWidth = 1.2; // pixels of AA falloff
  const xMin = Math.max(0, Math.floor(cx - r - aaWidth));
  const xMax = Math.min(w - 1, Math.ceil(cx + r + aaWidth));
  const yMin = Math.max(0, Math.floor(cy - r - aaWidth));
  const yMax = Math.min(h - 1, Math.ceil(cy + r + aaWidth));
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > (r + aaWidth) * (r + aaWidth)) continue;
      if (d2 <= r2) {
        setPx(buf, w, x, y, rgb, 255);
      } else {
        const d = Math.sqrt(d2);
        const t = 1 - (d - r) / aaWidth;
        setPx(buf, w, x, y, rgb, Math.round(t * 255));
      }
    }
  }
}

function fillBackground(buf, w, h, rgb) {
  for (let i = 0; i < w * h; i += 1) {
    buf[i * 4] = rgb[0];
    buf[i * 4 + 1] = rgb[1];
    buf[i * 4 + 2] = rgb[2];
    buf[i * 4 + 3] = 255;
  }
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  fillBackground(buf, size, size, BG);

  // Sun in the upper-left quadrant.
  const sunCx = size * 0.4;
  const sunCy = size * 0.42;
  const sunR = size * 0.22;
  drawCircle(buf, size, size, sunCx, sunCy, sunR, SUN);

  // Cloud: 3 overlapping circles forming a soft puff in the lower-right.
  const baseY = size * 0.62;
  const c1x = size * 0.42;
  const c2x = size * 0.58;
  const c3x = size * 0.74;
  const c1r = size * 0.16;
  const c2r = size * 0.22;
  const c3r = size * 0.15;
  drawCircle(buf, size, size, c1x, baseY, c1r, CLOUD);
  drawCircle(buf, size, size, c2x, baseY - size * 0.04, c2r, CLOUD);
  drawCircle(buf, size, size, c3x, baseY + size * 0.005, c3r, CLOUD);

  // A wide base "bar" for the cloud bottom — overlapping rounded ends.
  drawCircle(buf, size, size, (c1x + c3x) / 2, baseY + size * 0.05, size * 0.2, CLOUD);

  return encodePng(size, size, buf);
}

// ---------------------------------------------------------------------------
// SVG favicon — vector, ~600 bytes.
// ---------------------------------------------------------------------------

const FAVICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Weather">
  <rect width="64" height="64" rx="12" ry="12" fill="#0b1726"/>
  <circle cx="25" cy="27" r="14" fill="#f5c453"/>
  <g fill="#d9e2f0">
    <circle cx="27" cy="40" r="10"/>
    <circle cx="37" cy="37" r="14"/>
    <circle cx="47" cy="40" r="10"/>
    <rect x="22" y="40" width="30" height="12" rx="6"/>
  </g>
</svg>
`;

// ---------------------------------------------------------------------------
// Emit files.
// ---------------------------------------------------------------------------

const targets = [
  { path: 'pwa-192.png', size: 192 },
  { path: 'pwa-512.png', size: 512 },
  { path: 'apple-touch-icon-180.png', size: 180 },
];

for (const t of targets) {
  const buf = renderIcon(t.size);
  const out = resolve(PUBLIC, t.path);
  writeFileSync(out, buf);
  process.stdout.write(`wrote ${out} (${buf.length} bytes, ${t.size}x${t.size})\n`);
}

writeFileSync(resolve(PUBLIC, 'favicon.svg'), FAVICON_SVG, 'utf8');
process.stdout.write(`wrote ${resolve(PUBLIC, 'favicon.svg')} (${FAVICON_SVG.length} bytes)\n`);
