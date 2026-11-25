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

test("a displayed attachment hides only the sticker note, including adult and multiple stickers, keeping captions", () => {
  assert.equal(withoutStickerNote(envelope("[sticker: fox]")), "");
  assert.equal(withoutStickerNote(envelope("[sticker (18+): fox]")), "");
  assert.equal(withoutStickerNote("[sticker (18+)]"), "");
  assert.equal(withoutStickerNote(envelope("[sticker: fox holding a [hello] sign]")), "");
  assert.equal(withoutStickerNote(`Hello\n${envelope("[sticker: fox]")}\nGoodbye`), "Hello\n\nGoodbye");
  assert.equal(withoutStickerNote(`${envelope("[sticker: fox]")}\n${envelope("[sticker (18+): bear]")}`), "");
  assert.equal(withoutStickerNote("Look: [sticker: fox]"), "Look: [sticker: fox]");
});
