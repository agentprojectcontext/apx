import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaLoader, mediaKindOf } from "../dist/index.js";

test("a loading file's kind comes from its MIME type, then its extension", () => {
  assert.equal(mediaKindOf("video/mp4", "clip.bin"), "video");
  assert.equal(mediaKindOf("image/webp"), "image");
  assert.equal(mediaKindOf("audio/ogg"), "audio");
  assert.equal(mediaKindOf("application/octet-stream", "Reel.MOV"), "video");
  assert.equal(mediaKindOf(undefined, "photo.jpeg"), "image");
  assert.equal(mediaKindOf("application/pdf", "report.pdf"), "file");
  assert.equal(mediaKindOf(undefined, "README"), "file");
});

test("the loader draws its kind's icon and no text", () => {
  const html = renderToStaticMarkup(h(MediaLoader, { kind: "video" }));
  assert.match(html, /is-video/);
  assert.match(html, /aria-hidden="true"/);
  assert.equal(html.replace(/<[^>]*>/g, ""), "");
  assert.match(renderToStaticMarkup(h(MediaLoader, { kind: "file", inline: true })), /is-inline/);
});
