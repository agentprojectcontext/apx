// Smoke: the adapter seam — CLI → HTTP → core, against a live daemon.
//
// Every other test in tests/ calls core directly (rule 8). That leaves the wire
// between adapter and surface untested, which is where eight real bugs came
// from. These assert contracts, not behaviour: the field a surface reads is
// still sent, the envelope is still the shape callers unwrap, a new route did
// not swallow the SPA or escape auth.
//
// Runs on a temp HOME and a spare port, so it never touches the developer's own
// ~/.apx and never collides with their daemon.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-smoke-home-"));
// A spare port, so this never collides with the developer's own daemon.
const PORT = 7000 + Number(process.hrtime.bigint() % 900n);
const BASE = `http://127.0.0.1:${PORT}`;

let daemon;
let token = "";

function get(p, opts = {}) {
  return fetch(BASE + p, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
}

async function waitForDaemon(ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

before(async () => {
  fs.mkdirSync(path.join(TMP_HOME, ".apx"), { recursive: true });
  daemon = spawn(process.execPath, [path.join(ROOT, "src/host/daemon/index.js")], {
    env: { ...process.env, HOME: TMP_HOME, APX_PORT: String(PORT), APX_HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  assert.ok(await waitForDaemon(), `daemon did not come up on ${BASE}`);
  token = (await (await fetch(`${BASE}/admin/web-token`)).json()).token;
  assert.ok(token, "could not read the web token");
});

after(async () => {
  // Wait for the daemon to actually exit before deleting its HOME — it writes
  // on shutdown, and racing it makes rm fail with ENOTEMPTY.
  if (daemon && daemon.exitCode === null) {
    const exited = new Promise((resolve) => daemon.once("exit", resolve));
    try { daemon.kill("SIGTERM"); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});

// --------------------------------------------------------------------------
// auth — every new route must land behind it
// --------------------------------------------------------------------------

test("every API route requires a token", async () => {
  for (const p of ["/projects", "/tasks", "/inbox", "/profiles", "/profiles/doctor"]) {
    const r = await fetch(BASE + p); // deliberately unauthenticated
    assert.equal(r.status, 401, `${p} answered ${r.status} without a token`);
  }
});

// --------------------------------------------------------------------------
// response shapes the CLI unwraps
// --------------------------------------------------------------------------

// `apx task list` printed "(no tasks)" no matter what, because the endpoint
// answers {meta,data} and the CLI treated it as an array.
test("list endpoints answer the {meta,data} envelope callers unwrap", async () => {
  for (const p of ["/tasks", "/inbox"]) {
    const body = await (await get(p)).json();
    assert.ok(!Array.isArray(body), `${p} is a bare array — CLI callers unwrap .data`);
    assert.ok(Array.isArray(body.data), `${p} has no .data array`);
    assert.equal(typeof body.meta?.total, "number", `${p} has no meta.total`);
  }
});

// --------------------------------------------------------------------------
// fields a surface reads and the adapter must keep sending
// --------------------------------------------------------------------------

// `apx routine memory` resolves storage from GET /projects. Both fields were
// missing from the response, so the command failed before it could do anything.
test("GET /projects carries the storage fields the CLI resolves paths from", async () => {
  const projects = await (await get("/projects")).json();
  assert.ok(Array.isArray(projects) && projects.length, "no projects registered");
  for (const p of projects) {
    for (const field of ["id", "path", "name", "apx_id", "storage_path"]) {
      assert.ok(field in p, `project ${p.id} is missing "${field}"`);
    }
    assert.ok(p.storage_path, `project ${p.id} has an empty storage_path`);
  }
});

test("inbox rows carry every field the panel renders", async () => {
  const { data } = await (await get("/inbox")).json();
  for (const row of data) {
    for (const field of [
      "agent_slug", "agent_name", "kind", "pinned",
      "preview", "last_activity_at", "project_id", "project_name",
    ]) {
      assert.ok(field in row, `inbox row ${row.agent_slug} is missing "${field}"`);
    }
  }
});

test("profiles expose the schema, settings and prompt preview the panel needs", async () => {
  const { profiles } = await (await get("/profiles")).json();
  assert.ok(Array.isArray(profiles), "/profiles has no profiles array");
  if (!profiles.length) return; // nothing bundled in this build

  const detail = await (await get(`/profiles/${profiles[0].id}`)).json();
  for (const field of ["id", "name", "source", "schema", "config", "preview", "tokens"]) {
    assert.ok(field in detail, `profile detail is missing "${field}"`);
  }
  assert.ok(!String(detail.preview).includes("{{"), "raw template braces reached the preview");
});

// --------------------------------------------------------------------------
// routing — a new route must not swallow the SPA or be swallowed by it
// --------------------------------------------------------------------------

// /inbox is an API path AND was nearly an SPA route; isApiPath wins, so the
// screen would never have rendered.
test("API paths and SPA routes do not overlap", async () => {
  const { isApiPath, isKnownSpaRoute } = await import("#host/daemon/api/web.js");
  for (const p of ["/inbox", "/tasks", "/profiles", "/projects"]) {
    assert.ok(isApiPath(p), `${p} should be an API path`);
    assert.ok(!isKnownSpaRoute(p), `${p} is BOTH an API path and an SPA route`);
  }
  for (const p of ["/m/inbox", "/settings/profile", "/p/0/tasks"]) {
    assert.ok(isKnownSpaRoute(p), `${p} should be an SPA route`);
    assert.ok(!isApiPath(p), `${p} would be swallowed as an API path`);
  }
});

test("an unknown API path 404s instead of quietly serving the panel", async () => {
  const r = await get("/tasks/definitely-not-a-route/nope");
  assert.ok(r.status >= 400, `expected an error, got ${r.status}`);
});

// --------------------------------------------------------------------------
// filters the surfaces send must actually be honoured
// --------------------------------------------------------------------------

test("cross-project task filters are accepted, not silently ignored", async () => {
  const qs = "state=all&status=blocked&updated_since=2020-01-01T00:00:00Z&limit=5";
  const r = await get(`/tasks?${qs}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.length <= 5, "limit was ignored");
});

// The list above drifts by omission: someone adds a route and forgets the
// prefix, and an unknown path under it answers with SPA HTML instead of JSON.
// Derive the truth from the route registrations rather than trusting the list.
test("every top-level API route prefix is declared in API_PREFIXES", async () => {
  const { isApiPath } = await import("#host/daemon/api/web.js");
  const dir = path.join(ROOT, "src/host/daemon/api");
  const re = /app\.(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g;

  const prefixes = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    let m;
    while ((m = re.exec(src)) !== null) {
      const route = m[2];
      if (route === "/" || route === "*") continue;
      prefixes.add("/" + route.split("/")[1]);
    }
  }

  const undeclared = [...prefixes].filter((p) => !p.startsWith("/:") && !isApiPath(p)).sort();
  assert.deepEqual(
    undeclared,
    [],
    `these route prefixes are missing from API_PREFIXES: ${undeclared.join(", ")}`
  );
});

// Pairing nonces are one-shot on the daemon. The browser hook used to confirm
// twice under StrictMode, so the second call answered 409 and undid a pairing
// that had actually succeeded. This pins the daemon's half of that contract.
test("a pairing nonce is one-shot, and says so clearly the second time", async () => {
  const init = await (await get("/pair/init", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  assert.ok(init.pairing_id, "pair/init gave no pairing_id");
  assert.ok(init.ttl_ms >= 120_000, `TTL of ${init.ttl_ms}ms is too short to scan a QR by hand`);

  const body = (id) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairing_id: id, label: "smoke", kind: "web" }),
  });

  const first = await get("/pair/confirm", body(init.pairing_id));
  assert.equal(first.status, 200, "the first confirm must succeed");
  const client = await first.json();
  assert.ok(client.token, "no client token issued");
  assert.notEqual(client.token, token, "a paired client must NOT receive the master token");

  const second = await get("/pair/confirm", body(init.pairing_id));
  assert.equal(second.status, 409, "a spent nonce must be refused, not silently re-issued");

  // The paired client shows up as its own revocable entry.
  const { clients } = await (await get("/pair/list")).json();
  assert.ok(clients.some((c) => c.id === client.client_id), "paired client missing from /pair/list");
});
