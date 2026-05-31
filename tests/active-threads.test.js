import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildActiveThreadsBlock } from "../src/core/memory/active-threads.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-threads-"));
}

function writeTurn(base, channel, { direction, type, body, ts }) {
  const dir = path.join(base, channel);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts.slice(0, 10)}.jsonl`);
  fs.appendFileSync(file, JSON.stringify({ ts, channel, direction, type, body }) + "\n");
}

const cfg = { memory: { active_threads: { enabled: true, window_hours: 6, max_lines: 3 } } };

test("active-threads: surfaces recent turns from OTHER channels, excludes current", () => {
  const base = tmpDir();
  const now = new Date();
  const recent = new Date(now.getTime() - 12 * 60_000).toISOString(); // 12 min ago
  writeTurn(base, "telegram", { direction: "in", type: "user", body: "dale arrancá con el deploy del crm", ts: recent });
  writeTurn(base, "web", { direction: "in", type: "user", body: "este es el canal actual", ts: recent });

  const block = buildActiveThreadsBlock("web", { config: cfg, messagesDir: base });
  assert.match(block, /Hilos activos en otros canales/);
  assert.match(block, /telegram/);
  assert.match(block, /deploy del crm/);
  // The current channel (web) must NOT appear as a thread.
  assert.equal(/este es el canal actual/.test(block), false);
});

test("active-threads: empty when no other channel is active within the window", () => {
  const base = tmpDir();
  const old = new Date(Date.now() - 48 * 3600_000).toISOString(); // 2 days ago
  writeTurn(base, "telegram", { direction: "in", type: "user", body: "viejo mensaje", ts: old });
  const block = buildActiveThreadsBlock("web", { config: cfg, messagesDir: base });
  assert.equal(block, "");
});

test("active-threads: prefers the last USER turn and skips tool/system noise", () => {
  const base = tmpDir();
  const t = (m) => new Date(Date.now() - m * 60_000).toISOString();
  writeTurn(base, "deck", { direction: "in", type: "user", body: "anotá comprar el dominio", ts: t(20) });
  writeTurn(base, "deck", { direction: "out", type: "tool", body: "create_task({...})", ts: t(19) });
  writeTurn(base, "deck", { direction: "out", type: "agent", body: "Listo, lo anoté.", ts: t(18) });

  const block = buildActiveThreadsBlock("web", { config: cfg, messagesDir: base });
  assert.match(block, /deck/);
  // Last USER turn is preferred over the later agent/tool turns.
  assert.match(block, /comprar el dominio/);
});

test("active-threads: disabled flag returns empty", () => {
  const base = tmpDir();
  writeTurn(base, "telegram", { direction: "in", type: "user", body: "hola", ts: new Date().toISOString() });
  const block = buildActiveThreadsBlock("web", {
    config: { memory: { active_threads: { enabled: false } } },
    messagesDir: base,
  });
  assert.equal(block, "");
});

test("active-threads: respects max_lines cap", () => {
  const base = tmpDir();
  const ts = new Date(Date.now() - 5 * 60_000).toISOString();
  for (const ch of ["telegram", "deck", "desktop", "cli"]) {
    writeTurn(base, ch, { direction: "in", type: "user", body: `msg from ${ch}`, ts });
  }
  const block = buildActiveThreadsBlock("web", {
    config: { memory: { active_threads: { enabled: true, window_hours: 6, max_lines: 2 } } },
    messagesDir: base,
  });
  const bullets = block.split("\n").filter((l) => l.startsWith("• "));
  assert.equal(bullets.length, 2);
});
