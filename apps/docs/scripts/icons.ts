#!/usr/bin/env node
// Draws the site's raster icons from public/favicon.svg, the app's mark, on black like the desktop app's icon: the
// home-screen icon (public/apple-touch-icon.png), the search-result icon (public/favicon.png, a multiple of 48 px as
// Google asks) and public/favicon.ico for clients that only fetch /favicon.ico. Rerun it when the mark changes.
//   node --no-warnings scripts/icons.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const docs = path.resolve(import.meta.dirname, "..");
const svg = fs.readFileSync(path.join(docs, "public/favicon.svg"), "utf8");
const mark = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>")).replace(/<title[^>]*>.*?<\/title>/s, "");

/** The mark on black, `size` px square, the mark spanning `share` of it; `round` gives the app icon's corners. */
function tile(size: number, { share = 0.86, round = true } = {}) {
  const offset = (512 * (1 - share)) / 2;
  const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${round ? 112 : 0}" fill="#000"/>
    <g transform="translate(${offset} ${offset}) scale(${share})">${mark}</g></svg>`;
  return sharp(Buffer.from(art), { density: Math.max(72, (72 * size) / 512) * 4 })
    .resize(size, size)
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

// iOS rounds the home-screen icon itself, so it gets square corners and room around the mark.
write("apple-touch-icon.png", await tile(180, { share: 0.72, round: false }));
write("favicon.png", await tile(192));
write("favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await tile(size) })))));
