// Test images: an RGB PNG of any size, with horizontal stripes so a rendered page shows where the photo sits.

import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function makePng(width: number, height: number, color: [number, number, number] = [200, 220, 240]): Uint8Array {
  const row = 1 + width * 3;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const line = Math.floor(y / Math.max(1, Math.round(height / 24))) % 2 === 0;
    for (let x = 0; x < width; x++) {
      const o = y * row + 1 + x * 3;
      const edge = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const k = edge ? 0.3 : line ? 1 : 0.85;
      raw[o] = color[0] * k;
      raw[o + 1] = color[1] * k;
      raw[o + 2] = color[2] * k;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
