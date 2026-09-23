// Every model call, one line each: which model, from which surface, for whom,
// how long, and what it cost in tokens.
//
// There was no such record. On 2026-09-23 a ChatGPT plan was spent in under an
// hour and the only way to reconstruct why was counting a2a rows in the message
// ledgers — a successful model call left no trace anywhere, so "how many calls,
// on which account, from which agent" had no answer. The message ledger says
// what agents SAID; this says what saying it cost.
//
// ~/.apx/usage/<YYYY-MM-DD>.jsonl, UTC days. Appended asynchronously and never
// awaited by the caller: accounting must not slow a turn down or fail one.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { apxHome } from "#core/config/paths.js";

export function usageDir() {
  return path.join(apxHome(), "usage");
}

function dayFile(day) {
  return path.join(usageDir(), `${day}.jsonl`);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Input/output tokens from whichever shape the adapter reported. */
export function tokensOf(usage) {
  if (!usage || typeof usage !== "object") return { input: 0, output: 0 };
  return {
    input: num(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount),
    output: num(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount),
  };
}

let pending = Promise.resolve();

/**
 * Record one call. Fire-and-forget; returns the write's promise only so tests
 * can wait for it. Writes are chained so lines never interleave.
 */
export function recordLlmCall({ modelId, ms, ok, error = null, usage = null, attribution = null, now = new Date() }) {
  const { input, output } = tokensOf(usage);
  const row = {
    ts: now.toISOString(),
    model: modelId,
    ok: Boolean(ok),
    ms: Math.round(num(ms)),
    in: input,
    out: output,
    ...(attribution?.channel ? { channel: attribution.channel } : {}),
    ...(attribution?.agent ? { agent: attribution.agent } : {}),
    ...(attribution?.project != null ? { project: attribution.project } : {}),
    ...(error ? { error: String(error).slice(0, 200) } : {}),
  };
  const file = dayFile(row.ts.slice(0, 10));
  pending = pending
    .then(() => fsp.mkdir(usageDir(), { recursive: true }))
    .then(() => fsp.appendFile(file, JSON.stringify(row) + "\n"))
    .catch(() => { /* accounting never breaks a turn */ });
  return pending;
}

/** Test seam: wait for queued writes. */
export function flushLlmUsage() {
  return pending;
}

/** Every recorded call for `day` (YYYY-MM-DD, UTC). */
export function readLlmCalls(day) {
  let text = "";
  try {
    text = fs.readFileSync(dayFile(day), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped */ }
  }
  return out;
}

/**
 * Totals for a day, grouped three ways — by model (which account), by channel
 * (which surface), by agent (who). Each group: calls, failures, tokens in/out.
 * `sinceHour` narrows to calls at or after that UTC hour.
 */
export function summarizeLlmUsage(day, { sinceHour = null } = {}) {
  let calls = readLlmCalls(day);
  if (sinceHour != null) calls = calls.filter((c) => Number(c.ts.slice(11, 13)) >= sinceHour);
  const group = (key) => {
    const m = new Map();
    for (const c of calls) {
      const k = c[key] || "—";
      const g = m.get(k) || { key: k, calls: 0, failed: 0, in: 0, out: 0 };
      g.calls += 1;
      if (!c.ok) g.failed += 1;
      g.in += c.in || 0;
      g.out += c.out || 0;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.calls - a.calls);
  };
  return {
    day,
    total: calls.length,
    failed: calls.filter((c) => !c.ok).length,
    byModel: group("model"),
    byChannel: group("channel"),
    byAgent: group("agent"),
  };
}
