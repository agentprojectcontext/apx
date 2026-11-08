import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { fitForModel } from "./model-image.ts";

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();

test("a model gets a huge screenshot scaled down to about 2048×2048, and a small image as it was", async () => {
  const big = await fitForModel(await png(6000, 6000), "image/png");
  assert.equal(big.mime, "image/jpeg");
  const { width = 0, height = 0 } = await sharp(big.bytes).metadata();
  assert.ok(width * height <= 2048 * 2048, `${width}×${height}`);
  assert.ok(width >= 2000 && height >= 2000, `${width}×${height}`);

  const small = await png(800, 600);
  const kept = await fitForModel(small, "image/png");
  assert.equal(kept.mime, "image/png");
  assert.equal(kept.bytes, small);
});

test("a very long page keeps a readable width and no side past what providers take", async () => {
  const tall = await fitForModel(await png(1280, 30000), "image/png");
  const { width = 0, height = 0 } = await sharp(tall.bytes).metadata();
  assert.ok(height <= 7680 && width * height <= 2048 * 2048, `${width}×${height}`);
});

test("what it cannot read as an image goes as it was", async () => {
  const notImage = Buffer.from("not really a png");
  assert.equal((await fitForModel(notImage, "image/png")).bytes, notImage);
  const pdf = Buffer.from("%PDF-1.7");
  assert.deepEqual(await fitForModel(pdf, "application/pdf"), { mime: "application/pdf", bytes: pdf });
});
