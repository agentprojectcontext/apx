// Condenser v2 (OpenHands LLMSummarizingCondenser mechanics on top of the
// Pieza 3 compactor): structured state prompt, previous-summary threading,
// keep_first opening turns. Offline: throwaway HOME + the echoing `mock`
// engine — the mock returns the full user prompt in its reply, so the written
// compact record's body doubles as a capture of the prompt the condenser sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mem-condenser-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { GLOBAL_MESSAGES_DIR, mergeDefaults } = await import("#core/config/index.js");
const { appendGlobalMessage, parseDayJsonl, getRecentChannelTurnsFromFs } =
  await import("#core/stores/messages.js");
const { compactChannelIfNeeded } = await import("#core/memory/compactor.js");

const CONFIG = { memory: { compact_model: "mock", compact_fallback_model: "mock" } };
const NO_AGE_LIMIT = 24 * 365 * 50;

function seedTurns({ chat_id, from, count, startIndex = 0 }) {
  const base = new Date(from).getTime();
  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    appendGlobalMessage({
      channel: "telegram",
      direction: n % 2 ? "out" : "in",
      type: n % 2 ? "agent" : "user",
      body: `mensaje ${n}`,
      ts: new Date(base + i * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      meta: { chat_id },
    });
  }
}

function readCompacts(chat_id) {
  const dir = path.join(GLOBAL_MESSAGES_DIR, "telegram");
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
    for (const m of parseDayJsonl(fs.readFileSync(path.join(dir, f), "utf8"))) {
      if (m.type === "compact" && String(m.meta?.chat_id) === String(chat_id)) out.push(m);
    }
  }
  out.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return out;
}

test("config: memory.keep_first defaults to 2", () => {
  assert.equal(mergeDefaults({}).memory.keep_first, 2);
});

test("condenser: structured prompt with section markers; keep_first opening turns quoted verbatim, not condensed as events", async () => {
  const chat_id = 501;
  seedTurns({ chat_id, from: "2026-05-29T10:00:00Z", count: 8 });

  const res = await compactChannelIfNeeded({
    channel: "telegram",
    chat_id,
    config: CONFIG,
    maxTurns: 3,
    keepRecent: 1,
    keepFirst: 2,
    max_age_hours: NO_AGE_LIMIT,
  });
  assert.equal(res.compacted, true);

  const [rec] = readCompacts(chat_id);
  assert.ok(rec, "compact record written");
  assert.equal(rec.meta.condenser, "v2");
  assert.equal(rec.meta.prev_compact_ts, undefined, "first compaction threads nothing");

  // The mock engine echoed the prompt into the record body — inspect it.
  const prompt = rec.body;
  for (const marker of ["USER_CONTEXT", "TASK_TRACKING", "COMPLETED", "PENDING", "CURRENT_STATE"]) {
    assert.ok(prompt.includes(marker), `prompt carries ${marker} section`);
  }

  // Opening turns (mensaje 0 & 1) live in the verbatim block with the
  // original-goal instruction, and are NOT rendered as <EVENT> blocks.
  const opening = prompt.match(/<CONVERSATION_OPENING>([\s\S]*?)<\/CONVERSATION_OPENING>/)?.[1];
  assert.ok(opening, "opening block present on first condensation");
  assert.match(opening, /mensaje 0/);
  assert.match(opening, /mensaje 1/);
  assert.match(prompt, /ORIGINAL GOAL/);
  const eventsPart = prompt.slice(prompt.indexOf("</CONVERSATION_OPENING>"));
  assert.ok(!/mensaje 0/.test(eventsPart), "opening turn 0 excluded from events");
  assert.ok(!/mensaje 1/.test(eventsPart), "opening turn 1 excluded from events");
  // Later turns of the condensed span ARE events (boundary leaves `mensaje 7`
  // as the kept-recent turn, so 2..6 are condensed).
  assert.match(eventsPart, /<EVENT id=\d+ role=user>\nmensaje 2/);
  assert.match(eventsPart, /<EVENT id=\d+ role=assistant>\nmensaje 5/);
  assert.ok(!/mensaje 7/.test(prompt), "kept-recent turn never enters the condenser");
});

test("condenser: second compaction threads the previous summary and records prev_compact_ts", async () => {
  const chat_id = 501; // continue the same chat
  const [first] = readCompacts(chat_id);
  assert.ok(first, "fixture: first compact exists");

  // Fresh turns after the first compact boundary push it over threshold again.
  seedTurns({ chat_id, from: "2026-05-29T11:00:00Z", count: 5, startIndex: 8 });
  const res = await compactChannelIfNeeded({
    channel: "telegram",
    chat_id,
    config: CONFIG,
    maxTurns: 3,
    keepRecent: 1,
    max_age_hours: NO_AGE_LIMIT,
  });
  assert.equal(res.compacted, true);

  const compacts = readCompacts(chat_id);
  assert.equal(compacts.length, 2);
  const second = compacts[1];
  assert.equal(second.meta.condenser, "v2");
  assert.equal(second.meta.prev_compact_ts, first.ts);

  const prompt = second.body;
  assert.match(prompt, /<EVENT id=0 role=summary>\n\[PREVIOUS STATE SUMMARY\]/);
  assert.ok(
    prompt.includes(String(first.body).trim().slice(0, 120)),
    "previous summary text is embedded in the new prompt"
  );
  // keep_first only applies to the conversation opening (first condensation):
  // no fresh <CONVERSATION_OPENING> block before the events. (The string may
  // still appear INSIDE the threaded summary event — the mock echoes prompts.)
  const beforeEvents = prompt.slice(0, prompt.indexOf("<EVENT id=0"));
  assert.ok(!beforeEvents.includes("<CONVERSATION_OPENING>"), "no opening block when threading");
  assert.match(prompt, /<EVENT id=\d+ role=user>\nmensaje 8/);
});

test("condenser: reader still surfaces the v2 record as [RESUMEN COMPACTADO]", () => {
  const turns = getRecentChannelTurnsFromFs({
    channel: "telegram",
    chat_id: 501,
    max_age_hours: NO_AGE_LIMIT,
  });
  assert.equal(turns[0].role, "system");
  assert.match(turns[0].content, /\[RESUMEN COMPACTADO/);
});

test.after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
