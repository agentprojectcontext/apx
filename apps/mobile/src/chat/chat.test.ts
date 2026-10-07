import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../protocol";
import { choiceText, modelOptions, splitRef } from "./models.ts";
import { compact, usageText, withDays } from "./transcript.ts";

const message = (id: string, created_at: string): Message =>
  ({ id, thread_id: "t", seq: 1, author: { kind: "user" }, parts: [], created_at }) as Message;

test("each day starts with its own row, once", () => {
  const rows = withDays([
    message("a", new Date(2026, 9, 6, 22).toISOString()),
    message("b", new Date(2026, 9, 7, 8).toISOString()),
    message("c", new Date(2026, 9, 7, 9).toISOString()),
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "day" ? "day" : row.message.id)),
    ["day", "a", "day", "b", "c"],
  );
});

test("token counts read short, and the chat's fill shows over its window", () => {
  assert.equal(compact(950), "950");
  assert.equal(compact(1234), "1.2k");
  assert.equal(compact(26_000), "26k");
  assert.equal(compact(1_200_000), "1.2M");
  assert.equal(usageText({ context: 26_000, window: 200_000 }), "26k / 200k");
  assert.equal(usageText({}), undefined);
});

const catalog = [
  {
    id: "gemini",
    kind: "provider" as const,
    label: "Gemini",
    available: true,
    models: [
      { id: "flash", name: "Flash", chat: true },
      { id: "embed", name: "Embed", chat: false },
    ],
  },
  {
    id: "groq",
    kind: "provider" as const,
    label: "Groq",
    available: false,
    models: [{ id: "x", name: "X", chat: true }],
  },
  {
    id: "claude",
    kind: "harness" as const,
    label: "Claude Code",
    available: true,
    models: [{ id: "opus", name: "Opus", chat: true }],
  },
];

test("a chat offers the model APIs that answer now; a CLI session only that CLI's models", () => {
  assert.deepEqual(
    modelOptions(catalog, undefined).map((g) => [g.engine, g.models.map((m) => m.ref)]),
    [["Gemini", ["gemini/flash"]]],
  );
  assert.deepEqual(
    modelOptions(catalog, "claude").flatMap((g) => g.models.map((m) => m.ref)),
    ["claude/opus"],
  );
  assert.deepEqual(modelOptions(catalog, undefined, "nothing"), []);
});

test("a model choice reads as its ref without the effort, or as the router", () => {
  assert.deepEqual(splitRef("chatgpt/gpt-6#high"), { engine: "chatgpt", model: "gpt-6", effort: "high" });
  assert.equal(choiceText({ model: "chatgpt/gpt-6#high", router: false }, catalog, "Auto"), "chatgpt/gpt-6");
  assert.equal(choiceText({ model: "gemini", router: false }, catalog, "Auto"), "Gemini");
  assert.equal(choiceText({ router: true }, catalog, "Auto"), "Auto");
});
