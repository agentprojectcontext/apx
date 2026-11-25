import assert from "node:assert/strict";
import { test } from "node:test";
import { stickerDisplayText, stickerPreviewText, withoutStickerNote } from "./sticker-display.ts";

const envelope = (body: string) => `<sticker named_by="a model that saw it" trust="untrusted">\n${body}\n</sticker>`;

test("display unwraps sticker meanings, including already truncated previews, without changing the source", () => {
  const raw = envelope("[sticker: fox holding a heart]");
  assert.equal(stickerDisplayText(raw), "[sticker: fox holding a heart]");
  assert.equal(stickerDisplayText(raw.slice(0, 100)), "[sticker: fox holding a heart]");
  assert.equal(stickerDisplayText("Keep <b>this</b> and </sticker>"), "Keep <b>this</b> and </sticker>");
});

test("historical previews cut through either metadata line do not expose partial tags", () => {
  const raw = envelope("[sticker: fox]");
  const close = raw.indexOf("</sticker>");
  assert.equal(stickerPreviewText(raw.slice(0, close + 4)), "[sticker: fox]");
  assert.equal(stickerPreviewText(`Caption\n${raw}`.slice(0, 40)), "Caption");
  assert.equal(stickerPreviewText("Keep <b>this</b>"), "Keep <b>this</b>");
});

test("literal captions resembling annotations remain with or without generated metadata", () => {
  for (const caption of ["[sticker: examples] and [notes]", "[sticker: fox]", "[sticker (18+)]", "<stic", "<"]) {
    assert.equal(withoutStickerNote(caption), caption);
    assert.equal(withoutStickerNote(`${caption}\n${envelope("[sticker: fox]")}`), caption);
    assert.equal(stickerDisplayText(caption), caption);
    assert.equal(stickerPreviewText(caption), caption);
  }
});

test("historical previews hide any capped opening prefix and contextual closing prefix only", () => {
  for (let length = 1; length < 62; length++) {
    const opening = '<sticker named_by="a model that saw it" trust="untrusted">';
    if (length >= opening.length) break;
    const caption = "x".repeat(160 - length - 1);
    assert.equal(stickerPreviewText(`${caption}\n${opening.slice(0, length)}`), caption);
  }
  const wrapped = envelope("[sticker: fox]");
  const close = wrapped.indexOf("</sticker>");
  for (let length = 1; length < "</sticker>".length; length++) {
    assert.equal(stickerPreviewText(wrapped.slice(0, close + length)), "[sticker: fox]");
  }
  assert.equal(stickerPreviewText("Literal\n<stic"), "Literal\n<stic");
});

test("a capped literal prefix is restored from its original source instead of mistaken for metadata", () => {
  const caption = "x".repeat(154);
  const preview = `${caption}\n<stic`;
  assert.equal(stickerPreviewText("<stic", "<stic"), "<stic");
  assert.equal(stickerPreviewText("<stic", envelope("[sticker: fox]")), "");
  assert.equal(stickerPreviewText("<stic", ""), "");
  assert.equal(stickerPreviewText(preview, preview), preview);
  assert.equal(stickerPreviewText(preview, `${preview} is literal text`), preview);
  assert.equal(stickerPreviewText(preview, `${caption}\n${envelope("[sticker: fox]")}`), caption);
});

test("a displayed attachment hides only the sticker note, including adult and multiple stickers, keeping captions", () => {
  assert.equal(withoutStickerNote(envelope("[sticker: fox]")), "");
  assert.equal(withoutStickerNote(envelope("[sticker (18+): fox]")), "");
  assert.equal(withoutStickerNote("[sticker (18+)]"), "[sticker (18+)]");
  assert.equal(withoutStickerNote(envelope("[sticker: fox holding a [hello] sign]")), "");
  assert.equal(withoutStickerNote(`Hello\n${envelope("[sticker: fox]")}\nGoodbye`), "Hello\n\nGoodbye");
  assert.equal(withoutStickerNote(`${envelope("[sticker: fox]")}\n${envelope("[sticker (18+): bear]")}`), "");
  assert.equal(withoutStickerNote("Look: [sticker: fox]"), "Look: [sticker: fox]");
});
