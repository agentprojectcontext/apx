import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../protocol";
import { extensionOf, fileName, galleryFileName, mediaRows, mosaicRows, sizeText } from "./media.ts";

type Part = Message["parts"][number];

const video = (n: number): Part => ({
  type: "file",
  media_id: `med_v${n}`,
  name: `${n}.mp4`,
  mime: "video/mp4",
  bytes: 5_000_000,
});
const image = (n: number): Part => ({ type: "image", media_id: `med_i${n}`, mime: "image/jpeg", alt: `${n}.jpg` });

test("videos side by side become one carousel, and a tool call between them does not split it", () => {
  const tool = { type: "tool", call_id: "c1", tool: "send_file", title: "Send", status: "ok" } as Part;
  const rows = mediaRows([{ type: "text", text: "Here" }, video(1), tool, video(2), video(3)]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["part", "videos"],
  );
  const carousel = rows[1];
  assert.equal(carousel?.kind === "videos" && carousel.items.length, 3);
});

test("the owner's pictures (image parts) and image files gather into one grid; words between start a new one", () => {
  const photo: Part = { type: "file", media_id: "med_f", name: "shot.png", mime: "image/png", bytes: 10 };
  const rows = mediaRows([image(1), photo, { type: "text", text: "and" }, image(2)]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "images" ? row.items.length : row.kind)),
    [2, "part", 1],
  );
});

test("a sound and a plain file stay on their own; a document snapshot stays a document part", () => {
  const rows = mediaRows([
    { type: "audio", media_id: "med_a", mime: "audio/ogg" },
    { type: "file", media_id: "med_p", name: "a.pdf", mime: "application/pdf", bytes: 3 },
    {
      type: "file",
      media_id: "med_d",
      name: "notes.md",
      mime: "text/markdown",
      bytes: 3,
      document: { title: "Notes", format: "markdown" },
    },
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "media" ? row.item.kind : row.kind)),
    ["audio", "file", "part"],
  );
});

test("keys stay unique when the same media shows twice", () => {
  const keys = mediaRows([image(1), { type: "text", text: "x" }, image(1)]).map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("the grid's rows for each count, never more than five tiles", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 12].map(mosaicRows), [[1], [2], [1, 2], [2, 2], [2, 3], [2, 3]]);
});

test("a saved copy keeps its own extension, or gets one from its type", () => {
  assert.equal(extensionOf("video/mp4", "01-chela.MP4"), "mp4");
  assert.equal(extensionOf("image/jpeg"), "jpg");
  assert.equal(extensionOf("application/x-unknown", "noext"), "bin");
  assert.equal(sizeText(5_624_722), "5.4 MB");
});

test("gallery copies use an Android-recognized extension and URI-safe name, not an image caption", () => {
  for (const name of [
    "photo.bin",
    "photo",
    "photo.txt",
    "foto de Córdoba.png",
    "content://media/external/images/24",
    "https://example.com/photo?token=x",
  ]) {
    assert.equal(galleryFileName({ kind: "image", mime: "image/jpeg", name }), "asset.jpg");
  }
  assert.equal(galleryFileName({ kind: "image", mime: "IMAGE/PNG; charset=binary", name: "photo.jpg" }), "asset.png");
  assert.equal(galleryFileName({ kind: "image", mime: "image/webp", name: "photo" }), "asset.webp");
  assert.equal(galleryFileName({ kind: "video", mime: "video/mp4", name: "clip.bin" }), "asset.mp4");
  assert.equal(galleryFileName({ kind: "video", mime: "video/quicktime", name: "clip" }), "asset.mov");
});

test("documents and unrecognized gallery formats use Files instead of a generic MediaStore collection", () => {
  assert.equal(galleryFileName({ kind: "file", mime: "application/pdf", name: "photo.jpg" }), undefined);
  assert.equal(galleryFileName({ kind: "audio", mime: "audio/mpeg", name: "sound.mp3" }), undefined);
  assert.equal(galleryFileName({ kind: "image", mime: "image/x-unknown", name: "photo.bin" }), undefined);
  assert.equal(galleryFileName({ kind: "video", mime: "image/png", name: "clip.mp4" }), undefined);
});

test("a local copy keeps the file's own name, made safe, with an extension", () => {
  assert.equal(fileName({ name: "01-chela.mp4", mime: "video/mp4" }), "01-chela.mp4");
  assert.equal(fileName({ name: "a/b:c", mime: "image/png" }), "a_b_c.png");
  assert.equal(fileName({ name: "..", mime: "image/jpeg" }), "file.jpg");
});
