// HTTP-level tests for the commitments and nudges APIs.
//
// The unit tests exercise core directly (AGENTS.md rule 8), which leaves the
// wire between adapter and surface untested — the seam eight real bugs came
// from. These boot the real register() over a live socket and drive it the way
// the CLI and panel do.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-commit-api-"));
process.env.HOME = TMP_HOME;

const { register: registerCommitments } = await import("../src/host/daemon/api/commitments.js");
const { register: registerNudges } = await import("../src/host/daemon/api/nudges.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { _resetNudgeLedger } = await import("#core/nudge/store.js");
const { isApiPath } = await import("../src/host/daemon/api/web.js");

let STORE_A;
let STORE_B;

async function boot() {
  STORE_A = fs.mkdtempSync(path.join(TMP_HOME, "alpha-"));
  STORE_B = fs.mkdtempSync(path.join(TMP_HOME, "beta-"));

  const registry = [
    { id: "1", name: "alpha", path: "/tmp/alpha", storagePath: STORE_A },
    { id: "2", name: "beta", path: "/tmp/beta", storagePath: STORE_B },
  ];
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
  const router = apiRouter(express, app);
  registerCommitments(router, { project, projects });
  registerNudges(router, { project, projects });

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
    post: (p, b) => call("POST", p, b),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    close: () => new Promise((r) => server.close(r)),
  };
}

beforeEach(() => {
  _resetNudgeLedger();
  const cfg = readConfig();
  delete cfg.nudge;
  delete cfg.profile;
  writeConfig(cfg);
});

// --------------------------------------------------------------------------
// routing — rule 9
// --------------------------------------------------------------------------

test("the new paths are API paths, not SPA routes", () => {
  // Miss this and an authenticated GET is served as a web asset, without auth.
  for (const p of ["/api/commitments", "/api/nudges", "/api/nudges/policy",
                   "/api/projects/1/commitments"]) {
    assert.ok(isApiPath(p), `${p} should be an API path`);
  }
});

// --------------------------------------------------------------------------
// commitments over the wire
// --------------------------------------------------------------------------

test("create → list → keep, in the envelope callers unwrap", async () => {
  const api = await boot();
  try {
    const created = await api.post("/api/projects/1/commitments", {
      counterparty: "Ana", body: "the quote", due: "2026-05-01",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.counterparty, "Ana");

    const listed = await api.get("/api/projects/1/commitments");
    // `apx task list` printed "(no tasks)" forever because the CLI treated
    // this envelope as an array. Same shape, same expectation.
    assert.ok(!Array.isArray(listed.body), "must be {meta,data}, not a bare array");
    assert.equal(listed.body.data.length, 1);
    assert.equal(typeof listed.body.meta.total, "number");

    const kept = await api.post(`/api/projects/1/commitments/${created.body.id}/kept`, {});
    assert.equal(kept.body.state, "kept");
    const after = await api.get("/api/projects/1/commitments");
    assert.equal(after.body.data.length, 0, "kept ones leave the default view");
  } finally { await api.close(); }
});

test("a commitment with no counterparty is a 400, not a 500", async () => {
  const api = await boot();
  try {
    const r = await api.post("/api/projects/1/commitments", { body: "no one is waiting" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /counterparty/);
  } finally { await api.close(); }
});

test("unknown ids 404 across every mutation", async () => {
  const api = await boot();
  try {
    for (const [method, p, b] of [
      ["get", "/api/projects/1/commitments/nope"],
      ["post", "/api/projects/1/commitments/nope/kept", {}],
      ["post", "/api/projects/1/commitments/nope/missed", {}],
      ["post", "/api/projects/1/commitments/nope/renegotiate", { due: "2026-09-01" }],
      ["patch", "/api/projects/1/commitments/nope", { patch: { body: "x" } }],
    ]) {
      const r = await api[method](p, b);
      assert.equal(r.status, 404, `${method} ${p}`);
    }
  } finally { await api.close(); }
});

test("renegotiating without a date is refused at the edge", async () => {
  const api = await boot();
  try {
    const c = await api.post("/api/projects/1/commitments", { counterparty: "Ana", body: "x" });
    const r = await api.post(`/api/projects/1/commitments/${c.body.id}/renegotiate`, {});
    assert.equal(r.status, 400);
  } finally { await api.close(); }
});

test("patch without a patch object is a 400", async () => {
  const api = await boot();
  try {
    const c = await api.post("/api/projects/1/commitments", { counterparty: "Ana", body: "x" });
    const r = await api.patch(`/api/projects/1/commitments/${c.body.id}`, {});
    assert.equal(r.status, 400);
  } finally { await api.close(); }
});

test("an unknown project 404s rather than writing somewhere else", async () => {
  const api = await boot();
  try {
    const r = await api.post("/api/projects/99/commitments", { counterparty: "Ana", body: "x" });
    assert.equal(r.status, 404);
  } finally { await api.close(); }
});

test("the cross-project view carries the project on every row", async () => {
  const api = await boot();
  try {
    await api.post("/api/projects/1/commitments", { counterparty: "Ana", body: "alpha one", due: "2026-05-01" });
    await api.post("/api/projects/2/commitments", { counterparty: "Ana", body: "beta one", due: "2026-04-01" });

    const all = await api.get("/api/commitments?counterparty=ana");
    assert.equal(all.body.data.length, 2);
    assert.ok(all.body.data.every((c) => c.project_id && c.project_name));
    assert.equal(all.body.data[0].project_name, "beta", "soonest deadline first");

    const newest = await api.get("/api/commitments?sort=newest");
    assert.equal(newest.body.data.length, 2);
  } finally { await api.close(); }
});

test("filters are honoured, not silently ignored", async () => {
  const api = await boot();
  try {
    await api.post("/api/projects/1/commitments", { counterparty: "Ana", body: "late", due: "2020-01-01" });
    await api.post("/api/projects/1/commitments", { counterparty: "Bruno", body: "fine", due: "2099-01-01" });

    assert.equal((await api.get("/api/commitments?overdue=1")).body.data.length, 1);
    assert.equal((await api.get("/api/commitments?counterparty=bruno")).body.data.length, 1);
    assert.equal((await api.get("/api/commitments?due_before=2050-01-01")).body.data.length, 1);
    assert.equal((await api.get("/api/commitments?state=all&limit=1")).body.data.length, 1);
  } finally { await api.close(); }
});

test("the summary counts what the anchors report", async () => {
  const api = await boot();
  try {
    await api.post("/api/projects/1/commitments", { counterparty: "Ana", body: "late", due: "2020-01-01" });
    const s = await api.get("/api/projects/1/commitments-summary");
    assert.equal(s.body.open, 1);
    assert.equal(s.body.overdue, 1);
  } finally { await api.close(); }
});

// --------------------------------------------------------------------------
// nudges over the wire
// --------------------------------------------------------------------------

test("the policy endpoint says where each number came from", async () => {
  const api = await boot();
  try {
    const before = await api.get("/api/nudges/policy");
    assert.equal(before.body.policy.enabled, false);
    assert.deepEqual(before.body.source, ["defaults"]);

    const saved = await api.put("/api/nudges/policy", { enabled: true, daily_max: 2 });
    assert.equal(saved.body.policy.daily_max, 2);
    assert.ok(saved.body.source.includes("user"));

    // null hands the key back to whatever set it below.
    const cleared = await api.put("/api/nudges/policy", { daily_max: null });
    assert.equal(cleared.body.user_overrides.daily_max, undefined);
  } finally { await api.close(); }
});

test("check is a dry run — it never spends the budget", async () => {
  const api = await boot();
  try {
    await api.put("/api/nudges/policy", { enabled: true, daily_max: 1 });
    for (let i = 0; i < 5; i++) {
      const r = await api.post("/api/nudges/check", { kind: "signal" });
      assert.equal(r.body.allowed, true, "checking must not consume anything");
    }
    assert.equal((await api.get("/api/nudges")).body.data.length, 0);
  } finally { await api.close(); }
});

test("a solicited check is allowed even with the gate closed", async () => {
  const api = await boot();
  try {
    await api.put("/api/nudges/policy", { enabled: true, quiet_hours: "00:00-23:59" });
    const quiet = await api.post("/api/nudges/check", { kind: "signal" });
    assert.equal(quiet.body.allowed, false);
    const reply = await api.post("/api/nudges/check", { kind: "reply", unsolicited: false });
    assert.equal(reply.body.allowed, true);
  } finally { await api.close(); }
});

test("feedback needs a boolean, and 404s on an unknown id", async () => {
  const api = await boot();
  try {
    assert.equal((await api.post("/api/nudges/abc/feedback", { useful: "yes" })).status, 400);
    assert.equal((await api.post("/api/nudges/abc/feedback", { useful: true })).status, 404);
  } finally { await api.close(); }
});

test("the ledger reports its own stats alongside the rows", async () => {
  const api = await boot();
  try {
    const { canNudge, recordNudge } = await import("#core/nudge/index.js");
    const gate = canNudge({ kind: "day_open" }, {});
    recordNudge(gate, { preview: "morning" });

    const listed = await api.get("/api/nudges?limit=10");
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.meta.stats.total, 1);

    const rated = await api.post(`/api/nudges/${gate.nudge_id}/feedback`, { useful: false, note: "noise" });
    assert.equal(rated.body.entry.feedback.useful, false);
    assert.equal((await api.get("/api/nudges?with_feedback=1")).body.data.length, 1);
    assert.equal((await api.get("/api/nudges?with_feedback=0")).body.data.length, 0);
    assert.equal((await api.get("/api/nudges?kind=day_open")).body.data.length, 1);
    assert.equal((await api.get("/api/nudges?kind=nope")).body.data.length, 0);
  } finally { await api.close(); }
});
