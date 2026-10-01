import assert from "node:assert/strict";
import { test } from "node:test";
import type { RouterConfig } from "@apx/protocol";
import { candidates, type TurnFeatures } from "./choice.ts";

const f = (over: Partial<TurnFeatures> = {}): TurnFeatures => ({
  text: "hello",
  context_chars: 0,
  has_image: false,
  channel: "app",
  trigger: "user",
  agent_kind: "agent",
  ...over,
});
const router: RouterConfig = {
  rules: [
    { when: { keywords: ["code", "bug"] }, model: "codex" },
    { when: { min_chars: 2000 }, model: "claude/claude-opus-5-5" },
    { when: { triggers: ["a2a"], agent_kinds: ["agent"] }, model: "gemini/flash-lite" },
  ],
  chain: ["claude", "gemini/flash"],
};

test("a fixed model runs alone", () => {
  assert.deepEqual(candidates({ model: "codex/gpt-x", router: false }, router, f()), ["codex/gpt-x"]);
});

test("a model with the router: the model first, then the matching rule, then the chain", () => {
  assert.deepEqual(candidates({ model: "codex/gpt-x", router: true }, router, f({ text: "fix this bug" })), [
    "codex/gpt-x",
    "codex",
    "claude",
    "gemini/flash",
  ]);
});

test("the router alone: first matching rule wins, conditions all hold, no repeats", () => {
  assert.deepEqual(candidates({ router: true }, router, f({ text: "x".repeat(2500) })), [
    "claude/claude-opus-5-5",
    "claude",
    "gemini/flash",
  ]);
  assert.deepEqual(candidates({ router: true }, router, f({ trigger: "a2a" }))[0], "gemini/flash-lite");
  assert.deepEqual(candidates({ router: true }, router, f({ trigger: "a2a", agent_kind: "secretary" })), [
    "claude",
    "gemini/flash",
  ]);
});
