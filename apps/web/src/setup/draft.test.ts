import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEngine } from "@apx/protocol";
import { withStarters } from "./draft.ts";

const engine = (id: string, starter?: string, available = true): CatalogEngine => ({
  id,
  kind: "provider",
  label: id,
  available,
  models: [],
  ...(starter ? { starter } : {}),
});

test("a provider with no model in the chain brings its everyday one; the rest wait for the catalog", () => {
  const catalog = [engine("gemini", "gemini-2.5-flash"), engine("openai", "gpt-5-mini"), engine("groq", "x", false)];
  assert.deepEqual(withStarters(["openai/gpt-5#high"], ["openai", "gemini", "groq", "acme"], catalog), {
    chain: ["openai/gpt-5#high", "gemini/gemini-2.5-flash"],
    waiting: ["groq", "acme"],
  });
});
