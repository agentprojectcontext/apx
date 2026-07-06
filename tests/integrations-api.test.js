// HTTP-level test for the integrations API: boots the real register() in a bare
// Express app with a stub ProjectManager + temp storage, then drives the
// endpoints over a live socket. Verifies routing, scope handling, the
// configure→list→catalog→remove lifecycle, and error paths — without a daemon,
// auth, or a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { register } from "../src/host/daemon/api/integrations.js";

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `apx-api-${label}-`));
}

// Minimal stand-ins for the daemon ctx.
function makeCtx() {
  const base = { id: 0, storagePath: tmpdir("default") };
  const proj = { id: 1, storagePath: tmpdir("proj") };
  const projects = {
    get(id) {
      const n = Number(id);
      if (n === 0) return base;
      if (n === 1) return proj;
      return null;
    },
  };
  const project = (req, res) => {
    const p = projects.get(req.params.pid);
    if (!p) { res.status(404).json({ error: "project not found" }); return null; }
    return p;
  };
  return { projects, project, base, proj };
}

async function boot() {
  const ctx = makeCtx();
  const app = express();
  app.use(express.json());
  register(app, ctx);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* 204 */ }
    return { status: res.status, json };
  };
  return { call, close: () => server.close(), ctx };
}

test("catalog lists asana (implemented) + coming-soon plugins", async () => {
  const { call, close } = await boot();
  try {
    const { status, json } = await call("GET", "/projects/1/integrations/catalog");
    assert.equal(status, 200);
    const asana = json.find((c) => c.slug === "asana");
    assert.ok(asana && asana.coming_soon === false);
    assert.equal(asana.status.status, "disconnected");
    assert.ok(json.find((c) => c.slug === "github" && c.coming_soon === false), "github is implemented");
    assert.ok(json.find((c) => c.slug === "whatsapp" && c.coming_soon), "whatsapp is coming soon");
  } finally {
    close();
  }
});

test("configure → list (redacted) → status → deactivate → remove", async () => {
  const { call, close } = await boot();
  try {
    // configure at project scope
    let r = await call("POST", "/projects/1/integrations/asana/configure?scope=project", {
      personal_access_token: "1/secret:token",
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "pending_validation");
    // token must be redacted in the response
    assert.equal(r.json.config.personal_access_token, undefined);
    assert.equal(r.json.config.personal_access_token_set, true);

    // list shows it, redacted
    r = await call("GET", "/projects/1/integrations?scope=project");
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 1);
    assert.equal(r.json[0].config.personal_access_token, undefined);

    // status endpoint
    r = await call("GET", "/projects/1/integrations/asana?scope=project");
    assert.equal(r.status, 200);
    assert.equal(r.json.slug, "asana");

    // deactivate
    r = await call("POST", "/projects/1/integrations/asana/deactivate?scope=project");
    assert.equal(r.status, 200);
    assert.equal(r.json.is_enabled, false);

    // remove
    r = await call("DELETE", "/projects/1/integrations/asana?scope=project");
    assert.equal(r.status, 204);
    r = await call("GET", "/projects/1/integrations?scope=project");
    assert.equal(r.json.length, 0);
  } finally {
    close();
  }
});

test("scope=global writes to the default project's store", async () => {
  const { call, close, ctx } = await boot();
  try {
    await call("POST", "/projects/1/integrations/asana/configure?scope=global", {
      personal_access_token: "1/global:token",
    });
    // project scope must be empty; global (default project) must have it
    let r = await call("GET", "/projects/1/integrations?scope=project");
    assert.equal(r.json.length, 0);
    r = await call("GET", "/projects/1/integrations?scope=global");
    assert.equal(r.json.length, 1);
    // and it physically lives under the default project's storage
    assert.ok(fs.existsSync(path.join(ctx.base.storagePath, "integrations.json")));
  } finally {
    close();
  }
});

test("validate on an unconfigured plugin → 404; unknown plugin → 404; unknown scope → 400", async () => {
  const { call, close } = await boot();
  try {
    let r = await call("POST", "/projects/1/integrations/asana/validate?scope=project");
    assert.equal(r.status, 404);
    r = await call("GET", "/projects/1/integrations/nope?scope=project");
    assert.equal(r.status, 404);
    r = await call("GET", "/projects/1/integrations?scope=bogus");
    assert.equal(r.status, 400);
  } finally {
    close();
  }
});
