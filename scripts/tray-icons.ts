import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const assets = path.resolve(import.meta.dirname, "../apps/desktop/assets");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const name of ["trayTemplate", "trayTemplate-attention", "tray-color", "tray-color-attention"]) {
    const source = await fs.readFile(path.join(assets, `${name}.svg`), "utf8");
    for (const scale of [1, 2]) {
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
        { source, size: 22 * scale },
      );
      if (!png) throw new Error(`Empty tray image: ${name}`);
      await fs.writeFile(path.join(assets, `${name}${scale === 2 ? "@2x" : ""}.png`), Buffer.from(png, "base64"));
    }
  }
} finally {
  await browser.close();
}
