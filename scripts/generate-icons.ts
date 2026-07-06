/**
 * Generates PWA PNG icons (192/512) without image libraries: a lock glyph is
 * rasterized per-pixel and encoded as a minimal RGBA PNG (deflate + CRC32).
 * Run once: `bun run scripts/generate-icons.ts`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BG: readonly [number, number, number] = [0x0f, 0x6f, 0x5c];
const FG: readonly [number, number, number] = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
};

/** Signed distance-ish lock shape in a 0..1 unit square. */
const isLockPixel = (x: number, y: number): boolean => {
  const bodyTop = 0.46;
  const inBody = x >= 0.26 && x <= 0.74 && y >= bodyTop && y <= 0.82;
  const cx = 0.5;
  const cy = 0.38;
  const distance = Math.hypot(x - cx, y - cy);
  const inShackle = y <= bodyTop && distance <= 0.17 && distance >= 0.1;
  const inKeyhole =
    (Math.hypot(x - 0.5, y - 0.6) <= 0.055 || (Math.abs(x - 0.5) <= 0.025 && y >= 0.6 && y <= 0.72)) &&
    inBody;
  return (inBody || inShackle) && !inKeyhole;
};

const roundedCorner = (x: number, y: number, radius: number): boolean => {
  const dx = Math.min(x, 1 - x);
  const dy = Math.min(y, 1 - y);
  return dx < radius && dy < radius && Math.hypot(radius - dx, radius - dy) > radius;
};

const makePng = (size: number): Uint8Array => {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) {
    const offset = row * (size * 4 + 1);
    raw[offset] = 0;
    for (let col = 0; col < size; col += 1) {
      const x = (col + 0.5) / size;
      const y = (row + 0.5) / size;
      const transparent = roundedCorner(x, y, 0.12);
      const [r, g, b] = isLockPixel(x, y) ? FG : BG;
      const px = offset + 1 + col * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = transparent ? 0 : 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size);
  ihdrView.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = new Uint8Array(deflateSync(raw));
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  parts.reduce((position, part) => {
    out.set(part, position);
    return position + part.length;
  }, 0);
  return out;
};

const targetDir = join(import.meta.dir, '..', 'public', 'icons');
for (const size of [192, 512]) {
  writeFileSync(join(targetDir, `icon-${size}.png`), makePng(size));
  console.log(`icon-${size}.png written`);
}
