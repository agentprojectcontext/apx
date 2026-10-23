import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { bubbleFiles, mediaBlocks, withoutFilesNote } from "./mediaGroups.ts";

const video = (n: number): Part => ({ type: "file", media_id: `v${n}`, name: `${n}.mp4`, mime: "video/mp4", bytes: 9 });
const image = (n: number): Part => ({ type: "image", media_id: `i${n}`, mime: "image/jpeg", alt: "" });
const tool = { type: "tool", call_id: "c", tool: "send_file", title: "Send", status: "ok" } as Part;

test("videos side by side become one carousel, pictures one grid, and a tool call between them does not split it", () => {
  const blocks = mediaBlocks(
    [image(1), image(2), { type: "text", text: "x" }, video(1), tool, video(2)],
    (p) => p.type === "tool",
  );
  assert.deepEqual(
    blocks.map((b) => (b.kind === "part" ? b.part.type : `${b.kind}:${b.parts.length}`)),
    ["images:2", "text", "videos:2"],
  );
});

test("a document snapshot and other files stay parts of their own", () => {
  const doc: Part = {
    type: "file",
    media_id: "d",
    name: "a.md",
    mime: "text/markdown",
    bytes: 1,
    document: { title: "A", format: "markdown" },
  };
  const pdf: Part = { type: "file", media_id: "p", name: "a.pdf", mime: "application/pdf", bytes: 1 };
  assert.deepEqual(
    mediaBlocks([doc, pdf]).map((b) => b.kind),
    ["part", "part"],
  );
});

test("bubble attachments exclude gallery media but retain documents and voice notes in original order", () => {
  const pdf: Part = { type: "file", media_id: "pdf", name: "report.pdf", mime: "application/pdf", bytes: 1 };
  const audio: Part = { type: "audio", media_id: "audio", mime: "audio/ogg" };
  const doc: Part = {
    type: "file",
    media_id: "doc",
    name: "report.md",
    mime: "image/png",
    bytes: 1,
    document: { title: "Report", format: "markdown" },
  };
  assert.deepEqual(bubbleFiles([image(1), pdf, video(1), audio, doc]), [pdf, audio, doc]);
});

test("attachment placeholder text disappears only when real files are shown; normal text and unattached placeholders remain", () => {
  assert.equal(withoutFilesNote([image(1)], "  [attached files]  "), "");
  assert.equal(withoutFilesNote([video(1)], "Caption"), "Caption");
  assert.equal(withoutFilesNote([], "[attached files]"), "[attached files]");
  assert.equal(withoutFilesNote([image(1)], "Look: [attached files]"), "Look: [attached files]");
  assert.equal(withoutFilesNote([image(1)], "[sticker: white bear holding a heart balloon]"), "");
  assert.equal(withoutFilesNote([], "[sticker: white bear]"), "[sticker: white bear]");
});
