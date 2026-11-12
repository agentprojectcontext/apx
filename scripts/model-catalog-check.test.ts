import assert from "node:assert/strict";
import { test } from "node:test";
import { review, type Snapshot } from "./model-catalog-check.ts";

const snapshot = (gemini: string[], available = true): Snapshot => ({
  engines: [
    { id: "gemini", kind: "provider", available, models: gemini.map((id) => ({ id, chat: true })) },
    { id: "claude", kind: "harness", available: true, models: [{ id: "opus", chat: true }] },
  ],
  config: { default: { model: "gemini/gemini-3.8-flash" }, router: { chain: ["claude"], rules: [] } },
  agents: [
    { agent: "acme-dev", model_choice: { model: "gemini/gemini-2.5-pro#high", fallbacks: ["gemini/gemini-4-argon"] } },
    { agent: "acme-pm", model_choice: null },
  ],
});

test("reports models that appeared or left, and choices their provider no longer lists", () => {
  const out = review(snapshot(["gemini-3.8-flash", "gemini-4-argon"]), {
    gemini: ["gemini-2.5-pro", "gemini-3.8-flash"],
  });
  assert.deepEqual(out.changes_since_last_run, [
    { provider: "gemini", added: ["gemini-4-argon"], removed: ["gemini-2.5-pro"] },
  ]);
  assert.deepEqual(out.choices_no_longer_listed, ["agent acme-dev: gemini/gemini-2.5-pro#high"]);
  assert.ok(
    out.pinned_missing.some((p) => p.provider === "gemini"),
    "Gemini's voice default is not in this list",
  );
  assert.equal(out.first_run, false);
});

test("a provider that could not be read says nothing is gone", () => {
  const out = review(snapshot([], false), { gemini: ["gemini-2.5-pro"] });
  assert.deepEqual(out.changes_since_last_run, []);
  assert.deepEqual(out.choices_no_longer_listed, []);
  assert.deepEqual(out.pinned_missing, []);
  assert.deepEqual(out.not_refreshed, ["gemini: not available"]);
});
