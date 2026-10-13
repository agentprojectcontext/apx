import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { mediaBlocks } from "./mediaGroups.ts";

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
