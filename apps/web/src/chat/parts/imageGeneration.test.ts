import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part, RunState } from "@apx/protocol";
import { isGeneratingImage } from "./imageGeneration.ts";
import { mediaBlocks } from "./mediaGroups.ts";

const drawing: Part = { type: "tool", call_id: "draw", tool: "make_image", status: "running", title: "Drawing" };

test("only an executing image tool shows a preview, not confirmation or terminal runs", () => {
  for (const state of ["working", "submitted", "queued"] as const)
    assert.equal(isGeneratingImage(drawing, state), true);
  const inactive: Array<RunState | undefined> = [undefined, "input-required", "completed", "failed", "canceled"];
  for (const state of inactive) assert.equal(isGeneratingImage(drawing, state), false, state);
  for (const status of ["ok", "error"] as const)
    assert.equal(isGeneratingImage({ ...drawing, status }, "working"), false);
  assert.equal(isGeneratingImage({ ...drawing, tool: "send_file" }, "working"), false);
  assert.equal(isGeneratingImage({ type: "text", text: "make_image" }, "working"), false);
});

test("concurrent image calls keep their own inline slots and finished results use the existing grid", () => {
  const parts: Part[] = [
    drawing,
    { ...drawing, call_id: "second" },
    { type: "image", media_id: "med_first", mime: "image/png", alt: "First" },
    { type: "image", media_id: "med_second", mime: "image/png", alt: "Second" },
  ];
  const blocks = (state: RunState) => mediaBlocks(parts, (p) => p.type === "tool" && !isGeneratingImage(p, state));
  assert.deepEqual(
    blocks("working").map((b) => b.kind),
    ["part", "part", "images"],
  );
  const done = blocks("completed");
  assert.equal(done.length, 1);
  assert.equal(done[0]?.kind, "images");
  if (done[0]?.kind !== "images") throw new Error("Missing image grid");
  assert.equal(done[0].parts.length, 2);
});
