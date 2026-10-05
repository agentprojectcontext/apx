import assert from "node:assert/strict";
import { test } from "node:test";
import type { Store } from "../domain/store.ts";
import { fallbackNotice } from "./owner-words.ts";

const store = (lang: string) => ({ settings: { get: () => lang } }) as unknown as Store;

test("a model out of capacity is named, with why in a few words; the whole error is the detail", () => {
  const reason =
    'ollama/gemma4:31b-cloud: HTTP 429: {"error":{"message":"429 Too Many Requests: You reached the Free usage limit."}}';
  const n = fallbackNotice(store("es"), undefined, reason, "codex/gpt-6-luna#high");
  assert.equal(
    n.text,
    "ollama/gemma4:31b-cloud no tiene disponibilidad ahora (llegó a su límite de uso); sigo con codex/gpt-6-luna#high.",
  );
  assert.deepEqual(n.vars, {
    model: "ollama/gemma4:31b-cloud",
    why: "llegó a su límite de uso",
    to: "codex/gpt-6-luna#high",
  });
  assert.equal(n.detail, reason);
  const codex = fallbackNotice(store("en"), "Codex", "you hit your usage limit", "gemini/gemini-3.7-flash");
  assert.equal(
    codex.text,
    "Codex has no capacity right now (you hit your usage limit); trying gemini/gemini-3.7-flash.",
  );
});
