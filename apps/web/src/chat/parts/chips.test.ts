import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { chipFold, chipItems } from "./chips.ts";

const tool = (call_id: string, tool: string): Part => ({ type: "tool", call_id, tool, title: tool, status: "ok" });
const memory = (call: string, detail: string): Part => ({
  type: "notice",
  level: "info",
  code: "memory.saved",
  text: "Saved to memory",
  detail,
  vars: { call },
});

test("a turn's notes saved and research added are one chip each, and their steps leave the steps", () => {
  const research: Part = {
    type: "notice",
    level: "info",
    code: "research.updated",
    text: "Research updated",
    vars: { call: "r1", interests: "Jazz\nCine", location: "Córdoba" },
  };
  const parts = [
    tool("m1", "remember"),
    tool("w", "web_search"),
    memory("m1", "Likes jazz"),
    research,
    memory("m2", "Lives in Córdoba"),
  ];
  const { later, calls } = chipFold(parts);
  assert.deepEqual([...calls].sort(), ["m1", "m2", "r1"]);
  assert.deepEqual([...later], [parts[4]], "the second memory chip folds into the first");
  assert.deepEqual(chipItems(parts, "memory.saved"), [{ text: "Likes jazz" }, { text: "Lives in Córdoba" }]);
  assert.deepEqual(chipItems(parts, "research.updated"), [
    { field: "interests", text: "Jazz" },
    { field: "interests", text: "Cine" },
    { field: "location", text: "Córdoba" },
  ]);
});
