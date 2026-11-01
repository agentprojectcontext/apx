import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ICON_SIZES } from "./icons.ts";

const source = await fs.readFile(path.join(import.meta.dirname, "../web/src/assets/favicon.svg"), "utf8");
const destination = path.join(import.meta.dirname, "assets");
await fs.mkdir(destination, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of ICON_SIZES) {
    const png = await page.evaluate(
      async ({ source, size }) => {
        const image = new Image();
        const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas rendering unavailable");
          context.drawImage(image, 0, 0, size, size);
          return canvas.toDataURL("image/png").split(",")[1];
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { source, size },
    );
    if (!png) throw new Error(`Empty extension icon: ${size}`);
    await fs.writeFile(path.join(destination, `icon-${size}.png`), Buffer.from(png, "base64"));
  }
} finally {
  await browser.close();
}
