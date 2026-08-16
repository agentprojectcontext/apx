// HTTP-level test for the personas API: boots the real register() in a bare
// Express app against a temp APX home, then drives the endpoints over a live
// socket. Covers routing, the install → use → config → off → uninstall
// lifecycle, the prompt preview, and the error paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-personas-api-"));
process.env.HOME = TMP_HOME;

const { register } = await import("../src/host/daemon/api/personas.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { PERSONAS_DIR } = await import("#core/personas/paths.js");
const { isApiPath } = await import("../src/host/daemon/api/web.js");

let seq = 0;

function makePackage({ id = `api${++seq}`, manifest = {}, prompt = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apx-pkg-${id}-`));
  fs.writeFileSync(
    path.join(dir, "persona.json"),
    JSON.stringify({ id, name: `Persona ${id}`, version: "1.0.0", description: "A test persona", ...manifest })
  );
  fs.writeFileSync(
    path.join(dir, "PERSONA.md"),
    prompt ?? "# Role: Tester\nServing {{owner_name}}. Opens {{day_open_at}}."
  );
  fs.writeFileSync(
    path.join(dir, "config.schema.json"),
    JSON.stringify({
      type: "object",
      properties: {
        day_open_at: { type: "string", default: "08:30", title: "Day opens at" },
        nudge_budget_per_day: { type: "integer", default: 3 },
      },
    })
  );
  return { id, dir };
}

async function boot() {
  const app = express();
  app.use(express.json());
  register(app, {});
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
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
    del: (p) => call("DELETE", p),
    close: () => new Promise((r) => server.close(r)),
  };
}

function resetState() {
  const cfg = readConfig();
  delete cfg.persona;
  writeConfig(cfg);
  fs.rmSync(PERSONAS_DIR, { recursive: true, force: true });
}

// --------------------------------------------------------------------------

test("/personas is treated as an API path, not swallowed by the SPA fallback", () => {
  // AGENTS.md rule 9: miss this and an authenticated GET is served as a web
  // asset, without auth.
  assert.ok(isApiPath("/personas"));
  assert.ok(isApiPath("/personas/secretary"));
  assert.ok(isApiPath("/personas/doctor"));
});

test("GET /personas reports vanilla on a clean install", async () => {
  resetState();
  const api = await boot();
  try {
    const { status, body } = await api.get("/personas");
    assert.equal(status, 200);
    assert.equal(body.active, null);
    assert.ok(Array.isArray(body.personas));
  } finally {
    await api.close();
  }
});

test("install → use → config → off → uninstall over HTTP", async () => {
  resetState();
  const pkg = makePackage();
  const api = await boot();
  try {
    // install
    const installed = await api.post("/personas/install", { source: pkg.dir });
    assert.equal(installed.status, 200);
    assert.equal(installed.body.persona.id, pkg.id);
    assert.equal(installed.body.persona.active, false, "install must not activate");

    // use
    const used = await api.post("/personas/use", { id: pkg.id });
    assert.equal(used.status, 200);
    assert.equal(used.body.persona.active, true);
    assert.equal((await api.get("/personas")).body.active, pkg.id);

    // config
    const patched = await api.patch("/personas/config", { values: { day_open_at: "07:00" } });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body.changed, ["day_open_at"]);
    assert.equal(patched.body.config.day_open_at, "07:00");

    // the preview reflects the new setting
    const detail = await api.get(`/personas/${pkg.id}`);
    assert.equal(detail.status, 200);
    assert.match(detail.body.preview, /Opens 07:00\./);
    assert.ok(detail.body.tokens > 0);
    assert.ok(!detail.body.preview.includes("{{"), "preview must never show raw braces");

    // off
    const off = await api.post("/personas/off", {});
    assert.equal(off.status, 200);
    assert.equal(off.body.was, pkg.id);
    assert.equal((await api.get("/personas")).body.active, null);

    // uninstall
    const gone = await api.del(`/personas/${pkg.id}`);
    assert.equal(gone.status, 200);
    assert.equal((await api.get(`/personas/${pkg.id}`)).status, 404);
  } finally {
    await api.close();
  }
});

test("GET /personas/doctor resolves before the :id route", async () => {
  resetState();
  const api = await boot();
  try {
    const { status, body } = await api.get("/personas/doctor");
    assert.equal(status, 200);
    assert.equal(body.active, false);
    assert.match(body.summary, /vanilla/i);
  } finally {
    await api.close();
  }
});

test("doctor reports the active persona's token cost against its budget", async () => {
  resetState();
  const pkg = makePackage({ manifest: { prompt_budget_tokens: 900 } });
  const api = await boot();
  try {
    await api.post("/personas/install", { source: pkg.dir });
    await api.post("/personas/use", { id: pkg.id });

    const { body } = await api.get("/personas/doctor");
    assert.equal(body.id, pkg.id);
    assert.equal(body.active, true);
    assert.equal(body.budget, 900);
    assert.ok(body.tokens > 0);
    assert.equal(body.ok, true);
  } finally {
    await api.close();
  }
});

test("user errors return 400 with a message, not a 500", async () => {
  resetState();
  const api = await boot();
  try {
    assert.equal((await api.post("/personas/install", {})).status, 400);
    assert.equal((await api.post("/personas/use", { id: "nope" })).status, 400);
    assert.equal((await api.patch("/personas/config", {})).status, 400);
    assert.equal((await api.get("/personas/nope")).status, 404);

    const badUse = await api.post("/personas/use", { id: "nope" });
    assert.match(badUse.body.error, /not installed/);
  } finally {
    await api.close();
  }
});

test("an unknown setting is refused with a 400 naming what is accepted", async () => {
  resetState();
  const pkg = makePackage();
  const api = await boot();
  try {
    await api.post("/personas/install", { source: pkg.dir });
    await api.post("/personas/use", { id: pkg.id });

    const bad = await api.patch("/personas/config", { values: { nope: 1 } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /unknown setting "nope"/);
    assert.match(bad.body.error, /day_open_at/);
  } finally {
    await api.close();
  }
});

test("replacing an active persona requires force", async () => {
  resetState();
  const a = makePackage();
  const b = makePackage();
  const api = await boot();
  try {
    await api.post("/personas/install", { source: a.dir });
    await api.post("/personas/install", { source: b.dir });
    await api.post("/personas/use", { id: a.id });

    const clash = await api.post("/personas/use", { id: b.id });
    assert.equal(clash.status, 400);
    assert.match(clash.body.error, /already active/);

    const forced = await api.post("/personas/use", { id: b.id, force: true });
    assert.equal(forced.status, 200);
    assert.equal((await api.get("/personas")).body.active, b.id);
  } finally {
    await api.close();
  }
});
