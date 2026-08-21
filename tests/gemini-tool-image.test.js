// A multimodal tool result (view_media) must reach Gemini as an image. A
// functionResponse part can't carry pixels, so the engine emits the image on a
// following user turn with a short cue — right after the tool result. This pins
// that mapping so view_media stays wired to something the model can actually
// see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toGeminiContents } from "#core/engines/gemini.js";

test("toGeminiContents — a tool message with images emits an inlineData follow-up turn", () => {
  const contents = toGeminiContents([
    { role: "user", content: "mostrame el grip" },
    {
      role: "tool",
      tool_name: "view_media",
      tool_call_id: "c1",
      content: JSON.stringify({ ok: true, id: "grip" }),
      images: [{ data: "QUJD", mime: "image/jpeg" }],
    },
  ]);

  // The functionResponse turn, then a user turn carrying the inlineData.
  const withInline = contents.find(
    (c) => c.role === "user" && c.parts.some((p) => p.inlineData),
  );
  assert.ok(withInline, "an inlineData part is present");
  const img = withInline.parts.find((p) => p.inlineData);
  assert.equal(img.inlineData.mimeType, "image/jpeg");
  assert.equal(img.inlineData.data, "QUJD");
});

test("toGeminiContents — a tool message without images adds no extra turn", () => {
  const contents = toGeminiContents([
    { role: "tool", tool_name: "read_skill", tool_call_id: "c2", content: JSON.stringify({ ok: true }) },
  ]);
  assert.ok(!contents.some((c) => c.parts.some((p) => p.inlineData)), "no stray inlineData");
});
