// Pieza 1 (notebook entries) + Pieza 3 (progressive compaction + tool results
// in context). Uses a throwaway HOME so writes land in a temp ~/.apx, and the
// `mock` engine so compaction needs no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mem-compact-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { appendSelfMemory, parseSelfMemoryEntries, readSelfMemory, ensureSelfMemoryFile, SELF_MEMORY_PATH } =
  await import("#core/agent/self-memory.js");
const { appendGlobalMessage, getRecentChannelTurnsFromFs, getRecentTelegramTurnsFromFs } =
  await import("#core/stores/messages.js");
const { compactChannelIfNeeded } = await import("#core/memory/compactor.js");

// --- Pieza 1: notebook ------------------------------------------------------

test("ensureSelfMemoryFile: creates the notebook once", () => {
  fs.rmSync(SELF_MEMORY_PATH, { force: true });
  assert.equal(ensureSelfMemoryFile(), true);
  assert.equal(ensureSelfMemoryFile(), false, "second call is a no-op");
  assert.ok(fs.existsSync(SELF_MEMORY_PATH));
});

test("appendSelfMemory: channel-tagged bullet + parse round-trip", () => {
  fs.rmSync(SELF_MEMORY_PATH, { force: true });
  appendSelfMemory("revisamos el sanitizador del deck", { channel: "deck", time: "14:30" });
  appendSelfMemory("una nota legacy sin canal");
  const body = readSelfMemory();
  assert.match(body, /- \[14:30\]\[deck\] revisamos el sanitizador del deck/);

  const entries = parseSelfMemoryEntries(body);
  assert.equal(entries.length, 2);
  const tagged = entries.find((e) => e.channel === "deck");
  assert.ok(tagged);
  assert.equal(tagged.time, "14:30");
  assert.match(tagged.text, /sanitizador/);
  // Legacy bullet parses with the default "memory" channel.
  assert.ok(entries.some((e) => e.channel === "memory" && /legacy/.test(e.text)));
});

test("parseSelfMemoryEntries: tolerates full-timestamp form", () => {
  const entries = parseSelfMemoryEntries(
    "# Roby\n\n## 2026-05-01\n- [2026-05-02 09:15][web] dato acordado\n"
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-05-02");
  assert.equal(entries[0].time, "09:15");
  assert.equal(entries[0].channel, "web");
});

// --- Pieza 3: reader (tool inclusion, compaction, coalescing) ---------------

function seedTelegram(dir, chat_id, records) {
  const base = path.join(dir, "telegram");
  fs.mkdirSync(base, { recursive: true });
  const byDay = {};
  for (const r of records) {
    const day = r.ts.slice(0, 10);
    (byDay[day] ||= []).push({ ...r, channel: "telegram", meta: { chat_id, ...(r.meta || {}) } });
  }
  for (const [day, recs] of Object.entries(byDay)) {
    fs.writeFileSync(
      path.join(base, `${day}.jsonl`),
      recs.map((r) => JSON.stringify(r)).join("\n") + "\n"
    );
  }
}

test("reader: tool results are included, truncated and prefixed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-reader-"));
  const today = new Date().toISOString().slice(0, 10);
  seedTelegram(dir, 7, [
    { ts: `${today}T10:00:00Z`, direction: "in", type: "user", body: "leé el archivo" },
    { ts: `${today}T10:00:05Z`, direction: "out", type: "tool", body: "Z".repeat(900), meta: { tool_name: "read_file" } },
    { ts: `${today}T10:00:06Z`, direction: "out", type: "agent", body: "listo, lo leí" },
  ]);
  const turns = getRecentChannelTurnsFromFs({ channel: "telegram", chat_id: 7, _globalMessagesDir: dir });
  // user, then tool+agent coalesced onto the assistant side.
  assert.equal(turns[0].role, "user");
  assert.equal(turns[1].role, "assistant");
  assert.match(turns[1].content, /\[tool result: read_file\]/);
  assert.ok(turns[1].content.length <= 400 + 64, "tool slice stays bounded");
  assert.match(turns[1].content, /listo, lo leí/);
});

test("reader: a compact record is prepended as a system turn; covered turns dropped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-reader2-"));
  const today = new Date().toISOString().slice(0, 10);
  seedTelegram(dir, 9, [
    { ts: `${today}T08:00:00Z`, direction: "in", type: "user", body: "tema viejo uno" },
    { ts: `${today}T08:00:05Z`, direction: "out", type: "agent", body: "respuesta vieja" },
    { ts: `${today}T09:00:00Z`, direction: "out", type: "compact", body: "Resumen: discutimos el tema viejo.", meta: { compact: true, range: [1, 2], count: 2, covers_until_ts: `${today}T08:30:00Z` } },
    { ts: `${today}T10:00:00Z`, direction: "in", type: "user", body: "tema nuevo" },
  ]);
  const turns = getRecentChannelTurnsFromFs({ channel: "telegram", chat_id: 9, _globalMessagesDir: dir });
  assert.equal(turns[0].role, "system");
  assert.match(turns[0].content, /\[RESUMEN COMPACTADO turnos 1-2\]/);
  assert.match(turns[0].content, /tema viejo/);
  // The raw turns the compact covers are gone; only the newer turn remains.
  assert.ok(!turns.some((t) => /respuesta vieja/.test(t.content)));
  assert.ok(turns.some((t) => t.role === "user" && /tema nuevo/.test(t.content)));
});

test("reader: keepRecent caps verbatim turns; telegram wrapper delegates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-reader3-"));
  const today = new Date().toISOString().slice(0, 10);
  const recs = [];
  for (let i = 0; i < 5; i++) {
    recs.push({ ts: `${today}T10:0${i}:00Z`, direction: i % 2 ? "out" : "in", type: i % 2 ? "agent" : "user", body: `turno ${i}` });
  }
  seedTelegram(dir, 3, recs);
  const turns = getRecentChannelTurnsFromFs({ channel: "telegram", chat_id: 3, keepRecent: 2, _globalMessagesDir: dir });
  const realCount = turns.reduce((n, t) => n + (t.role !== "system" ? 1 : 0), 0);
  assert.ok(realCount <= 2);
  assert.match(turns[turns.length - 1].content, /turno 4/);

  // Back-compat wrapper returns the same shape.
  const viaWrapper = getRecentTelegramTurnsFromFs({ chat_id: 3, keepRecent: 2, _globalMessagesDir: dir });
  assert.deepEqual(viaWrapper, turns);
});

// --- Pieza 3: compactor end-to-end (mock engine) ----------------------------

test("compactChannelIfNeeded: below threshold is a no-op", async () => {
  const r = await compactChannelIfNeeded({ channel: "telegram", chat_id: 111, config: {}, maxTurns: 60, keepRecent: 40 });
  assert.ok(r.skipped);
});

test("compactChannelIfNeeded: over threshold writes a compact record via the mock model", async () => {
  const chat_id = 222;
  const base = new Date("2026-05-29T10:00:00Z").getTime();
  for (let i = 0; i < 5; i++) {
    appendGlobalMessage({
      channel: "telegram",
      direction: i % 2 ? "out" : "in",
      type: i % 2 ? "agent" : "user",
      body: `mensaje ${i}`,
      ts: new Date(base + i * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      meta: { chat_id },
    });
  }
  const config = { memory: { compact_model: "mock", compact_fallback_model: "mock" } };
  const res = await compactChannelIfNeeded({
    channel: "telegram",
    chat_id,
    config,
    maxTurns: 3,
    keepRecent: 1,
    max_age_hours: 24 * 365 * 50, // ignore the age window for this fixed-date fixture
  });
  assert.equal(res.compacted, true);
  assert.ok(res.turns >= 1);
  assert.match(res.model, /mock/);

  // A second run is now below threshold (only the kept turn is uncovered).
  const again = await compactChannelIfNeeded({
    channel: "telegram",
    chat_id,
    config,
    maxTurns: 3,
    keepRecent: 1,
    max_age_hours: 24 * 365 * 50,
  });
  assert.ok(again.skipped, "no re-compaction once caught up");
});

test.after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
