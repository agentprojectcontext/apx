import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part, RunState } from "@apx/protocol";
import { imageGenerationBlocks, imageGenerationRuns, isGeneratingImage } from "./imageGeneration.ts";

const drawing: Extract<Part, { type: "tool" }> = {
  type: "tool",
  call_id: "draw",
  tool: "make_image",
  status: "running",
  title: "Drawing",
};
const picture = (id: string, call?: string): Extract<Part, { type: "image" }> => ({
  type: "image",
  media_id: id,
  alt: id,
  ...(call ? { tool_call_id: call } : {}),
});
const blocks = (parts: Part[], state: RunState = "working") => imageGenerationBlocks(parts, state, () => false);

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

test("results replace the call's slot without consuming unrelated pictures or changing order", () => {
  const pending = blocks([drawing])[0];
  const completed = blocks(
    [
      drawing,
      { type: "text", text: "After the drawing" },
      picture("first", "draw"),
      picture("second", "draw"),
      picture("other"),
    ],
    "completed",
  );
  assert.equal(pending?.kind, "generation");
  const result = completed[0];
  if (pending?.kind !== "generation" || result?.kind !== "generation") throw new Error("Missing generation slot");
  assert.equal(result.key, pending.key);
  assert.deepEqual(
    result.media?.parts.map((p) => p.media_id),
    ["first", "second"],
  );
  assert.deepEqual(
    completed.map((b) => b.kind),
    ["generation", "part", "images"],
  );
});

test("concurrent calls resolve out of order into their own stable slots", () => {
  const parts: Part[] = [drawing, { ...drawing, call_id: "second" }, picture("two", "second")];
  const pending = blocks(parts);
  assert.deepEqual(
    pending.map((b) => b.kind === "generation" && [b.key, b.media?.parts.map((p) => p.media_id)]),
    [
      ["generation:draw", undefined],
      ["generation:second", ["two"]],
    ],
  );
  const done = blocks([...parts, picture("one", "draw")], "completed");
  assert.deepEqual(
    done.map((b) => b.kind === "generation" && [b.key, b.media?.parts.map((p) => p.media_id)]),
    [
      ["generation:draw", ["one"]],
      ["generation:second", ["two"]],
    ],
  );
});

test("segmented messages resolve in the original slot, scoped to their run and excluding user images", () => {
  const tool: Part = { ...drawing, status: "ok" };
  const result = picture("segmented", "draw");
  const runs = imageGenerationRuns([
    { author: { kind: "agent", id: "agent" }, run_id: "run-a", parts: [tool] },
    { author: { kind: "user" }, run_id: "run-a", parts: [picture("user", "draw")] },
    { author: { kind: "agent", id: "agent" }, run_id: "run-a", parts: [result] },
    { author: { kind: "agent", id: "agent" }, run_id: "run-b", parts: [drawing] },
  ]);
  const original = imageGenerationBlocks([tool], "completed", () => false, runs.get("run-a"));
  assert.equal(original[0]?.kind, "generation");
  if (original[0]?.kind !== "generation") throw new Error("Missing original slot");
  assert.deepEqual(original[0].media?.parts, [result]);
  assert.deepEqual(
    imageGenerationBlocks([result], "completed", () => false, runs.get("run-a")),
    [],
  );
  const other = imageGenerationBlocks([drawing], "working", () => false, runs.get("run-b"));
  assert.equal(other[0]?.kind, "generation");
  if (other[0]?.kind !== "generation") throw new Error("Missing other run's slot");
  assert.equal(other[0].media, undefined);
  assert.equal(imageGenerationBlocks([result], "completed", () => false)[0]?.kind, "images");
});

test("failure and cancellation clear empty slots but keep delivered partial results", () => {
  for (const state of ["failed", "canceled"] as const) {
    assert.deepEqual(blocks([drawing], state), []);
    const result = blocks([drawing, picture("one", "draw")], state)[0];
    assert.equal(result?.kind, "generation");
  }
  assert.deepEqual(blocks([{ ...drawing, status: "error" }]), []);
});

test("historical and orphaned pictures keep the ordinary grid; other tools never get a slot", () => {
  const result = blocks(
    [drawing, picture("old"), picture("orphan", "unknown"), { ...drawing, tool: "send_file" }],
    "completed",
  );
  assert.deepEqual(
    result.map((b) => b.kind),
    ["images"],
  );
  if (result[0]?.kind !== "images") throw new Error("Missing historical grid");
  assert.equal(result[0].parts.length, 2);
});
