import assert from "node:assert/strict";
import { test } from "node:test";
import { turnShare } from "../engine/turn.ts";
import type { Usage } from "../providers/types.ts";
import { usageOf } from "./acp/harness.ts";
import { claudeUsage } from "./claude.ts";

test("a Claude Code turn counts each call once, cached prompt included, its subagents' calls too", () => {
  const seen: Usage[] = [];
  const t = claudeUsage((u) => seen.push(u));
  // The call starts (stream), then the SDK repeats its usage on each content block, and the delta gives the output.
  t.call("m1", { input_tokens: 4, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000 }, true);
  t.call("m1", { input_tokens: 4, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000 }, true);
  t.call("m1", { output_tokens: 120 }, true);
  t.call("m1", { input_tokens: 4, output_tokens: 80 }, true);
  // A subagent's call adds its tokens but says nothing of how full the turn's own chat is.
  t.call("s1", { input_tokens: 10, cache_read_input_tokens: 5_000, output_tokens: 300 }, false);
  t.call("m2", { input_tokens: 6, cache_read_input_tokens: 32_500, output_tokens: 40 }, true);
  t.window(1_000_000);
  assert.deepEqual(t.total(), {
    input: 32_004 + 5_010 + 32_506,
    output: 120 + 300 + 40,
    cached: 30_000 + 5_000 + 32_500,
    context: 32_506,
    window: 1_000_000,
  });
  // Reported as it grew, never twice for the same figures.
  assert.equal(seen.length, 4);
  assert.equal(seen[0]?.input, 32_004);
});

test("a Claude Code turn with no call reports no tokens", () => {
  const t = claudeUsage(() => {});
  t.call(undefined, { input_tokens: 5 }, true);
  assert.equal(t.total(), undefined);
});

test("an ACP agent's cached tokens count as prompt only when its total left them out of the input", () => {
  // Counted apart: the total adds them on top.
  assert.deepEqual(
    usageOf(
      { inputTokens: 10, outputTokens: 5, cachedReadTokens: 900, totalTokens: 915 },
      { used: 915, size: 200_000 },
    ),
    { input: 910, output: 5, cached: 900, context: 915, window: 200_000 },
  );
  // Already inside the input.
  assert.deepEqual(usageOf({ inputTokens: 910, outputTokens: 5, cachedReadTokens: 900, totalTokens: 915 }, {}), {
    input: 910,
    output: 5,
    cached: 900,
  });
  assert.deepEqual(usageOf({ inputTokens: 10, outputTokens: 5 }, {}), { input: 10, output: 5 });
});

test("a turn's share of an engine session's running total", () => {
  const total = { input: 600, output: 30, cached: 500 };
  // A new session: all of it is this turn's.
  assert.deepEqual(turnShare(total, undefined, false), total);
  assert.deepEqual(turnShare(total, { input: 500, output: 20, cached: 450 }, true), {
    input: 100,
    output: 10,
    cached: 50,
  });
  // A session brought in from outside, with nothing to subtract: no figure rather than a wrong one.
  assert.equal(turnShare(total, undefined, true), undefined);
  // A total stored without its cached part never makes more cached than prompt.
  assert.deepEqual(turnShare(total, { input: 500, output: 20 }, true), { input: 100, output: 10, cached: 100 });
});
