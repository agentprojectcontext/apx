// GET/PUT /api/notebook — the super-agent's own memory over HTTP.
//
// This is the file that ships in EVERY prompt on every channel, and it had no
// screen until it had a route. Both halves matter: reading it must report the
// cost (a person deciding whether to prune needs the number), and writing it
// must refuse a body large enough to tax every future turn.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-notebook-api-"));
process.env.HOME = TMP_HOME;

const { register } = await import("../src/host/daemon/api/self-memory.js");
const { SELF_MEMORY_PATH, appendSelfMemory, readSelfMemory } = await import("#core/agent/self-memory.js");
const { isApiPath } = await import("../src/host/daemon/api/web.js");

async function boot() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  register(apiRouter(express, app), {});
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return {
    get: (p) => call("GET", p),
    put: (p, b) => call("PUT", p, b),
    close: () => new Promise((r) => server.close(r)),
  };
}

beforeEach(() => {
  try { fs.rmSync(SELF_MEMORY_PATH, { force: true }); } catch { /* nothing there */ }
});

test("/api/notebook is an API path, not swallowed by the SPA", () => {
  assert.ok(isApiPath("/api/notebook"));
});

test("an empty notebook reads as empty rather than 404", async () => {
  // The screen has to render something on a fresh install; a 404 would look
  // like the feature is broken.
  const api = await boot();
  try {
    const r = await api.get("/api/notebook");
    assert.equal(r.status, 200);
    assert.equal(r.body.body, "");
    assert.equal(r.body.entries, 0);
    assert.ok(r.body.path.endsWith("memory.md"));
  } finally { await api.close(); }
});

test("reading reports the cost, because every turn pays it", async () => {
  const api = await boot();
  try {
    appendSelfMemory("Manu prefers pnpm over npm across every package", { channel: "telegram" });
    const r = await api.get("/api/notebook");
    assert.match(r.body.body, /pnpm/);
    assert.ok(r.body.chars > 0);
    assert.ok(r.body.approx_tokens > 0, "the number a person prunes against");
    assert.equal(r.body.entries, 1);
    assert.equal(r.body.consolidated, 0, "how much was machine-written");
  } finally { await api.close(); }
});

test("a write round-trips", async () => {
  const api = await boot();
  try {
    const body = "# notebook\n\n## 2026-08-17\n- [10:00][manual] a note typed by hand\n";
    const put = await api.put("/api/notebook", { body });
    assert.equal(put.status, 200);
    assert.equal(readSelfMemory(), body);
    assert.equal((await api.get("/api/notebook")).body.body, body);
  } finally { await api.close(); }
});

test("clearing it is allowed — an empty notebook is a valid choice", async () => {
  const api = await boot();
  try {
    appendSelfMemory("something to be removed later", { channel: "web" });
    assert.equal((await api.put("/api/notebook", { body: "" })).status, 200);
    assert.equal(readSelfMemory(), "");
  } finally { await api.close(); }
});

test("a non-string body is a 400, not a file full of JSON", async () => {
  const api = await boot();
  try {
    assert.equal((await api.put("/api/notebook", { body: { a: 1 } })).status, 400);
    assert.equal((await api.put("/api/notebook", {})).status, 400);
    assert.equal((await api.put("/api/notebook", { body: 42 })).status, 400);
  } finally { await api.close(); }
});

test("an oversized notebook is refused, and the refusal says why", async () => {
  // Not an arbitrary limit: this file is injected into every prompt, so a
  // megabyte here is a megabyte on every turn of every channel.
  const api = await boot();
  try {
    const r = await api.put("/api/notebook", { body: "x".repeat(300 * 1024) });
    assert.equal(r.status, 413);
    assert.match(r.body.error, /every prompt/);
  } finally { await api.close(); }
});
