import { inflateSync } from "node:zlib";

/** An RGBA image decoded from a Playwright screenshot (8-bit, non-interlaced PNG). */
export type Pixels = { width: number; height: number; at: (x: number, y: number) => [number, number, number] };

export function decodePng(png: Buffer): Pixels {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? (out[y * stride + i - channels] ?? 0) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + i] ?? 0) : 0;
      const corner = y > 0 && i >= channels ? (out[(y - 1) * stride + i - channels] ?? 0) : 0;
      const byte = line[i] ?? 0;
      let value = byte;
      if (filter === 1) value = byte + left;
      else if (filter === 2) value = byte + up;
      else if (filter === 3) value = byte + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        value = byte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      }
      out[y * stride + i] = value & 255;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const i = Math.round(y) * stride + Math.round(x) * channels;
      return [out[i] ?? 0, out[i + 1] ?? 0, out[i + 2] ?? 0];
    },
  };
}
