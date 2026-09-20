// HTTP-level tests for the milestones API.
//
// The store and the derivation are unit-tested against core directly
// (tests/milestones.test.js, AGENTS.md rule 8). These boot the real register()
// over a live socket and drive it the way the panel does — the seam where a
// route reads a different store than the one the feature writes to, or answers
// a shape the client cannot use, is the one units cannot see.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-milestone-api-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // APX_HOME, not HOME alone

const { register } = await import("../src/host/daemon/api/milestones.js");
const { startConversation, appendTurn } = await import("#core/stores/conversations.js");

async function boot() {
  const store = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const registry = [{ id: "1", name: "acme", path: "/tmp/acme", storagePath: store }];
  const projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
  const project = (req, res) => {
    const p = projects.get(req.params.pid);
    if (!p) { res.status(404).json({ error: "project not found" }); return null; }
    return p;
  };

  const app = express();
  app.use(express.json());
  register(apiRouter(express, app), { project, projects });

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
    store,
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    patch: (p, b) => call("PATCH", p, b),
    close: () => new Promise((r) => server.close(r)),
  };
}

function seedLedger(store, rows) {
  const dir = path.join(store, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const byDay = new Map();
  for (const r of rows) {
    const day = r.ts.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  for (const [day, list] of byDay) {
    fs.writeFileSync(
      path.join(dir, `${day}.jsonl`),
      list.map((r) => JSON.stringify(r)).join("\n") + "\n"
    );
  }
}

test("POST records a step and GET reads it back on the chat it belongs to", async () => {
  const api = await boot();
  try {
    const conv = startConversation({
      storagePath: api.store, agentSlug: "rocky", engine: "mock:test", system: "sys",
    });
    appendTurn({ filePath: conv.path, role: "user", content: "make the reel" });
    appendTurn({ filePath: conv.path, role: "assistant", content: "done" });

    const created = await api.post("/api/projects/1/milestones", {
      title: "Material analysed",
      state: "done",
      conversation_id: conv.id,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.state, "done");

    const got = await api.get(`/api/projects/1/agents/rocky/conversations/${conv.id}/milestones`);
    assert.equal(got.status, 200);
    assert.equal(got.body.entries.length, 1);
    assert.equal(got.body.entries[0].title, "make the reel");
    assert.equal(got.body.entries[0].milestones[0].title, "Material analysed");
    assert.equal(got.body.stats.done, 1);
  } finally {
    await api.close();
  }
});

test("a title-less step is a 400, not a row with an empty line in it", async () => {
  const api = await boot();
  try {
    const r = await api.post("/api/projects/1/milestones", { state: "done" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /title required/);
  } finally {
    await api.close();
  }
});

test("closing a step names the outcome; an unknown one is refused", async () => {
  const api = await boot();
  try {
    const { body: m } = await api.post("/api/projects/1/milestones", {
      title: "Rendering", state: "open",
    });
    const bad = await api.post(`/api/projects/1/milestones/${m.id}/close`, { state: "nearly" });
    assert.equal(bad.status, 400);

    const ok = await api.post(`/api/projects/1/milestones/${m.id}/close`, {
      state: "failed", note: "no audio track",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.state, "failed");
    assert.equal(ok.body.note, "no audio track");
  } finally {
    await api.close();
  }
});

test("closing something that is not there is a 404", async () => {
  const api = await boot();
  try {
    const r = await api.post("/api/projects/1/milestones/m_nope/close", { state: "done" });
    assert.equal(r.status, 404);
  } finally {
    await api.close();
  }
});

test("a patch needs a patch object rather than loose fields", async () => {
  const api = await boot();
  try {
    const { body: m } = await api.post("/api/projects/1/milestones", { title: "Draft" });
    assert.equal((await api.patch(`/api/projects/1/milestones/${m.id}`, { title: "x" })).status, 400);
    const ok = await api.patch(`/api/projects/1/milestones/${m.id}`, { patch: { title: "Draft v2" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.title, "Draft v2");
  } finally {
    await api.close();
  }
});

test("the cross-chat view reports what was left open, across channels", async () => {
  const api = await boot();
  try {
    seedLedger(api.store, [
      { ts: "2026-09-18T10:00:00Z", channel: "telegram", type: "user", agent_slug: "rocky", body: "make the reel", meta: { conversation: "c1" } },
      { ts: "2026-09-18T10:05:00Z", channel: "telegram", type: "agent", agent_slug: "rocky", body: "done", meta: { conversation: "c1", tool_summary: { total: 3, failed: 0, tools: [] } } },
      { ts: "2026-09-18T11:00:00Z", channel: "web", type: "user", agent_slug: "magui", body: "upload the recap", meta: { conversation: "c2" } },
    ]);

    const all = await api.get("/api/projects/1/milestones?since=2026-09-18T00:00:00Z");
    assert.equal(all.status, 200);
    assert.equal(all.body.entries.length, 2);
    assert.equal(all.body.stats.open, 1, "the web request was never answered");
    // The one the whole feature exists for: findable without knowing which chat
    // to open.
    const stalled = all.body.entries.find((e) => e.state === "open");
    assert.equal(stalled.channel, "web");
    assert.equal(stalled.title, "upload the recap");
  } finally {
    await api.close();
  }
});

test("the range only answers for the days asked for", async () => {
  const api = await boot();
  try {
    seedLedger(api.store, [
      { ts: "2026-01-02T10:00:00Z", channel: "web", type: "user", agent_slug: "rocky", body: "old thing", meta: { conversation: "old" } },
      { ts: "2026-09-18T10:00:00Z", channel: "web", type: "user", agent_slug: "rocky", body: "new thing", meta: { conversation: "new" } },
    ]);
    const recent = await api.get("/api/projects/1/milestones?since=2026-09-01T00:00:00Z");
    assert.equal(recent.body.entries.length, 1);
    assert.equal(recent.body.entries[0].title, "new thing");
  } finally {
    await api.close();
  }
});

test("a ledger thread (the super-agent's own chat) has a timeline too", async () => {
  const api = await boot();
  try {
    const day = "2026-09-18";
    // Global channel threads live under APX_HOME, not the project — the route
    // has to reach the right store or this comes back as a 404.
    const dir = path.join(process.env.APX_HOME, "messages", "web");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${day}.jsonl`),
      [
        // `project_id`, which is how the global ledger scopes a row to a
        // project (rowProject / keepForProject). A row stamped any other way
        // belongs to the default workspace and this thread 404s.
        { ts: `${day}T09:00:00Z`, channel: "web", direction: "in", type: "user", body: "post the recap", meta: { project_id: "1" } },
        { ts: `${day}T09:02:00Z`, channel: "web", direction: "out", type: "agent", body: "posted", meta: { project_id: "1", tool_summary: { total: 2, failed: 1, tools: [] } } },
      ].map((r) => JSON.stringify(r)).join("\n") + "\n"
    );

    const r = await api.get(`/api/projects/1/super-agent/threads/web/${day}/milestones`);
    assert.equal(r.status, 200);
    assert.equal(r.body.entries.length, 1);
    assert.equal(r.body.entries[0].title, "post the recap");
    assert.equal(r.body.entries[0].state, "failed", "a tool failed inside it");
  } finally {
    await api.close();
  }
});

test("a thread that does not exist is a 404, not an empty timeline", async () => {
  const api = await boot();
  try {
    const r = await api.get("/api/projects/1/super-agent/threads/web/2026-01-01/milestones");
    assert.equal(r.status, 404);
  } finally {
    await api.close();
  }
});

test("an unknown project is a 404 on every route", async () => {
  const api = await boot();
  try {
    assert.equal((await api.get("/api/projects/99/milestones")).status, 404);
    assert.equal((await api.post("/api/projects/99/milestones", { title: "x" })).status, 404);
  } finally {
    await api.close();
  }
});
