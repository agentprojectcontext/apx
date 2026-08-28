// Deterministic offline engine. Always available, always last in the chain.
//
// It exists for the same reason the TTS mock does: tests run with no network
// and no keys (project rule 1), and a caller that asks for a picture when
// nothing is configured should get a real file back rather than an exception
// from four different servers in a row. The PNG is a solid colour derived from
// the prompt, so the same prompt always yields the same swatch — a useful
// property when a test wants to assert "the pipeline wrote the bytes it was
// given" without shipping a fixture.

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { writeImage } from "./shared.js";

const SIZE = 64;

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal hand-rolled PNG encoder — no image dependency for a test fixture. */
function solidPng(r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array(SIZE).fill(Buffer.from([r, g, b])))]);
  const raw = Buffer.concat(Array(SIZE).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export default {
  id: "mock",

  // `count` is the one option it genuinely honors — it really does write N
  // files. Everything else is accepted and ignored, and saying so is what
  // keeps the "ignored options" report honest.
  supports: ["count"],

  async isAvailable() { return true; },

  async generate({ prompt, count, outDir }) {
    const digest = createHash("sha256").update(String(prompt || "")).digest();
    const n = Math.max(1, Math.min(Number(count) || 1, 4));
    return {
      images: Array.from({ length: n }, (_, i) =>
        ({ ...writeImage(solidPng(digest[i * 3], digest[i * 3 + 1], digest[i * 3 + 2]),
                         { outDir, provider: "mock", format: "png", index: i }),
           seed: digest.readUInt32BE(0) })),
      model: "mock",
      meta: { note: "generated offline by the mock engine" },
    };
  },
};
