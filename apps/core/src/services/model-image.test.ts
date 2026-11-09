import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";
import sharp from "sharp";
import { fitForModel } from "./model-image.ts";

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();

test("a model gets a huge screenshot scaled down to about 2048×2048, and a small image as it was", async () => {
  const big = await fitForModel(await png(6000, 6000), "image/png");
  assert.ok(big);
  assert.equal(big.mime, "image/jpeg");
  const { width = 0, height = 0 } = await sharp(big.bytes).metadata();
  assert.ok(width * height <= 2048 * 2048, `${width}×${height}`);
  assert.ok(width >= 2000 && height >= 2000, `${width}×${height}`);

  const small = await png(800, 600);
  const kept = await fitForModel(small, "image/png");
  assert.ok(kept);
  assert.equal(kept.mime, "image/png");
  assert.equal(kept.bytes, small);
});

test("a very long page keeps a readable width and no side past what providers take", async () => {
  const tall = await fitForModel(await png(1280, 30000), "image/png");
  assert.ok(tall);
  const { width = 0, height = 0 } = await sharp(tall.bytes).metadata();
  assert.ok(height <= 7680 && width * height <= 2048 * 2048, `${width}×${height}`);
});

test("a broken image is left out rather than sent to be refused, and a file that is no image goes as it was", async () => {
  assert.equal(await fitForModel(Buffer.from("not really a png"), "image/png"), undefined);
  const pdf = Buffer.from("%PDF-1.7");
  assert.deepEqual(await fitForModel(pdf, "application/pdf"), { mime: "application/pdf", bytes: pdf });
});

test("a phone photo reaches the model upright, whatever way the camera stored it", async () => {
  // Stored landscape, shown portrait: EXIF orientation 6 means "turn 90° clockwise to view".
  const stored = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const fit = await fitForModel(stored, "image/jpeg");
  assert.ok(fit);
  const { width = 0, height = 0, orientation } = await sharp(fit.bytes).metadata();
  assert.ok(height > width, `portrait expected, got ${width}×${height}`);
  assert.ok(orientation === undefined || orientation === 1, `no turn left to apply, got ${orientation}`);
  assert.ok(width * height <= 2048 * 2048, `${width}×${height}`);
});

test("an animation too big for a call goes as its first frame, scaled down", async () => {
  const frame = (r: number) =>
    sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
  const animated = await sharp([await frame(0), await frame(255)], { join: { animated: true } })
    .gif()
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2, "fixture is animated");
  const fit = await fitForModel(animated, "image/gif");
  assert.ok(fit);
  const { width = 0, height = 0, pages = 1 } = await sharp(fit.bytes).metadata();
  assert.equal(pages, 1);
  assert.ok(width * height <= 2048 * 2048, `${width}×${height}`);
});

test("an image too large to open is left out instead of sent whole", async () => {
  // A PNG whose header says 20000×20000: past what the decoder agrees to open, so it can never be made to fit.
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([size, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(20000, 0);
  header.writeUInt32BE(20000, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const huge = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(64))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.equal(
    (await sharp(huge, { limitInputPixels: false }).metadata()).width,
    20000,
    "fixture reads as a huge image",
  );
  assert.equal(await fitForModel(huge, "image/png"), undefined);
});
