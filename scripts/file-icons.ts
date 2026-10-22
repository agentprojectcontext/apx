// Document icons for the files APX opens (.apxart, .apxapp, .apxext): each source image in apps/desktop/assets
// (file-<kind>.webp) scaled to the sizes the systems ask for, then packed as .icns (macOS, through iconutil) and .ico
// (Windows, PNG entries).
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const assets = path.resolve(import.meta.dirname, "../apps/desktop/assets");
const KINDS = ["apxart", "apxapp", "apxext"] as const;
const ICNS = [16, 32, 128, 256, 512] as const;
const ICO = [16, 24, 32, 48, 64, 128, 256] as const;

/** An .ico whose entries are PNGs (Windows Vista and later read them). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (source: string, size: number) => {
    const png = await page.evaluate(
      async ({ source, size }) => {
        const image = new Image();
        const bytes = Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas rendering unavailable");
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, size, size);
          return canvas.toDataURL("image/png").split(",")[1];
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { source, size },
    );
    if (!png) throw new Error(`Empty image at ${size}px`);
    return Buffer.from(png, "base64");
  };
  for (const kind of KINDS) {
    const source = (await fs.readFile(path.join(assets, `file-${kind}.webp`))).toString("base64");
    await fs.writeFile(path.join(assets, `file-${kind}.png`), await render(source, 512));
    const sizes = [...new Set([...ICO, ...ICNS.flatMap((s) => [s, s * 2])])];
    const png = new Map<number, Buffer>();
    for (const size of sizes) png.set(size, await render(source, size));
    await fs.writeFile(
      path.join(assets, `file-${kind}.ico`),
      ico(ICO.map((size) => ({ size, data: png.get(size) ?? Buffer.alloc(0) }))),
    );
    if (process.platform !== "darwin") {
      console.warn(`file-${kind}.icns needs macOS's iconutil: kept as it is`);
      continue;
    }
    const set = await fs.mkdtemp(path.join(os.tmpdir(), "apx-icons-"));
    const iconset = path.join(set, `file-${kind}.iconset`);
    await fs.mkdir(iconset);
    for (const s of ICNS) {
      await fs.writeFile(path.join(iconset, `icon_${s}x${s}.png`), png.get(s) ?? Buffer.alloc(0));
      await fs.writeFile(path.join(iconset, `icon_${s}x${s}@2x.png`), png.get(s * 2) ?? Buffer.alloc(0));
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(assets, `file-${kind}.icns`)]);
    await fs.rm(set, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}
