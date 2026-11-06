#!/usr/bin/env node
// Draws the site's raster icons from src/assets/logo.png on the dark tile: the home-screen icon
// (public/apple-touch-icon.png), the search-result icon (public/favicon.png, a multiple of 48 px as Google asks) and
// public/favicon.ico for clients that only fetch /favicon.ico. Rerun it when the logo changes.
//   node --no-warnings scripts/icons.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const docs = path.resolve(import.meta.dirname, "..");
const logo = path.join(docs, "src/assets/logo.png");

/** The logo centred on the dark tile, `size` px square, the mark taking `share` of it. */
async function tile(size: number, share = 0.7) {
  const markSize = Math.round(size * share);
  const mark = await sharp(logo).resize(markSize, markSize).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: "#0b0d11" } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

/** An .ico holding PNG images (allowed since Windows Vista and read by every browser). */
function ico(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const write = (file: string, data: Buffer) => {
  fs.writeFileSync(path.join(docs, "public", file), data);
  console.log(`public/${file} ${(data.length / 1024).toFixed(1)} KB`);
};

write("apple-touch-icon.png", await tile(180, 124 / 180));
write("favicon.png", await tile(192));
write("favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await tile(size, 0.8) })))));
