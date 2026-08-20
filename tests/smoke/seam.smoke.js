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
//
// History: after the /api route refactor five of these failed for weeks and the
// cause was written off as "not yet understood", because the same calls worked by
// hand. They did — by hand you write the prefix once. The tests wrote it twice:
// get() prefixes /api itself, and the calls passed "/api/tasks", so every request
// went to /api/api/tasks and 404'd. Worse, "an unknown API path 404s" PASSED on
// that same 404, for entirely the wrong reason. get() now rejects a doubled
// prefix outright, so the mistake cannot come back quietly.
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
// Every data route lives under /api. Hitting the bare path does not 404 — it
// falls through to the SPA, so a test that forgets the prefix passes while
// asserting nothing. That is exactly what happened when this file was written
// against the pre-refactor layout.
const API = `${BASE}/api`;

let daemon;
let token = "";

// `p` is the path BELOW /api — this helper adds the prefix. Passing "/api/x"
// used to silently produce /api/api/x, which 404s; five tests failed that way
// for weeks and one of them ("an unknown API path 404s") passed for the wrong
// reason. Refuse the doubled prefix instead of letting it look like a real 404.
function get(p, opts = {}) {
  if (p.startsWith("/api/") || p === "/api") {
    throw new Error(`get() already prefixes /api — pass "${p.slice(4)}", not "${p}"`);
  }
  return fetch(API + p, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
}

async function waitForDaemon(ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
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
  assert.ok(await waitForDaemon(), `daemon did not come up on ${API}`);
  token = (await (await fetch(`${BASE}/api/admin/web-token`)).json()).token;
  assert.ok(token, "could not read the web token");

  // Contract tests assert that FIELDS are present, which needs at least one row
  // to look at. A fresh HOME has none, and an empty list would let every
  // assertion pass vacuously — the failure mode this whole file exists to stop.
  const projectDir = path.join(TMP_HOME, "smoke-project");
  fs.mkdirSync(path.join(projectDir, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "AGENTS.md"), "# Smoke project\n");
  fs.writeFileSync(
    path.join(projectDir, ".apc", "project.json"),
    JSON.stringify({ name: "smoke", apx_id: "smoke" })
  );

  const reg = await get("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: projectDir }),
  });
  assert.ok(reg.ok, `could not register the smoke project (HTTP ${reg.status})`);
  const project = await reg.json();

  const task = await get(`/projects/${project.id}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "smoke task", tags: ["smoke"] }),
  });
  assert.ok(task.ok, `could not create a task (HTTP ${task.status})`);
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
  for (const p of ["/api/projects", "/api/tasks", "/api/inbox", "/api/profiles", "/api/profiles/doctor"]) {
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
  assert.ok(Array.isArray(profiles), "/api/profiles has no profiles array");
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
  for (const p of ["/api/inbox", "/api/tasks", "/api/profiles", "/api/projects"]) {
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

// This used to check a hand-written API_PREFIXES list for missing entries.
// That list is gone: every route module now registers on the Router that
// api.js mounts at /api, so a new route lands under the prefix by
// construction and cannot be forgotten.
//
// What CAN still go wrong is a module registering on the raw `app` instead of
// the router — that route would sit at the root, outside auth's /api rules and
// in the SPA's namespace. web.js is the one legitimate exception: it serves
// the static panel at the root on purpose.
test("no route module registers on the root app instead of the /api router", () => {
  const dir = path.join(ROOT, "src/host/daemon/api");
  const re = /\bapp\.(get|post|put|patch|delete|use|all)\s*\(/g;

  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    if (f === "web.js") continue; // owns the root namespace by design
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    if (re.test(src)) offenders.push(f);
    re.lastIndex = 0;
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    `these modules register at the root instead of on the /api router: ${offenders.join(", ")}`
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
