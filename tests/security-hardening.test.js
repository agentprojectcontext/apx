// Regression tests for the security-audit hardening pass.
//   1. Auth allowlist: data GETs require a bearer; only assets + SPA routes are public.
//   2. Path traversal: /files rejects paths escaping the project root (prefix bypass).
//   3. Confirmation guard: only the initiating actor can answer a guarded confirmation.
//   4. SSRF: the http fetch tool refuses private / loopback / numeric-encoded targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { ConfirmationPendingStore } from "#core/confirmation/pending-store.js";
import { http_get } from "#core/http-tools/fetch.js";

const TOKEN = "s3cret-token";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeApp() {
  const projects = new ProjectManager({});
  projects.registerDefault(); // id 0 — gives /files a real project root
  return buildApi({
    projects,
    registries: null,
    plugins: { instances: new Map(), get: () => null, status: () => ({}) },
    scheduler: null,
    version: "9.9.9",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: TOKEN,
  });
}

// ── 1. Auth allowlist ──────────────────────────────────────────────────────

test("data GET routes NOT in the old prefix list now require a token", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    for (const route of ["/plugins", "/skills"]) {
      const res = await fetch(`${baseUrl}${route}`); // no Authorization
      assert.equal(res.status, 401, `${route} must require auth`);
    }
    // Same route WITH a token is allowed through to its handler.
    const ok = await fetch(`${baseUrl}/plugins`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200, "/plugins with a valid token should be served");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("static assets and known SPA routes stay public (no token)", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    for (const p of ["/assets/app-abc123.js", "/logo.svg", "/settings", "/p/0/tasks", "/"]) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.notEqual(res.status, 401, `${p} should not require auth (asset/SPA shell)`);
    }
    // /health remains explicitly public.
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── 2. Path traversal ───────────────────────────────────────────────────────

test("GET /files rejects paths escaping the project root", async () => {
  const { server, baseUrl } = await listen(makeApp());
  const auth = { authorization: `Bearer ${TOKEN}` };
  try {
    const escape = await fetch(`${baseUrl}/files?path=${encodeURIComponent("../../../../../../etc/passwd")}`, { headers: auth });
    assert.equal(escape.status, 403, "traversal outside root must be 403");

    // A sibling dir that shares the root's name prefix must NOT bypass the guard
    // (the classic startsWith-without-separator hole).
    const siblingPrefix = await fetch(`${baseUrl}/files?path=${encodeURIComponent("../default-evil")}`, { headers: auth });
    assert.equal(siblingPrefix.status, 403, "prefix-sibling traversal must be 403");

    // An in-root read still works (proves we didn't over-block).
    const inRoot = await fetch(`${baseUrl}/files?path=${encodeURIComponent(".apc/project.json")}`, { headers: auth });
    assert.equal(inRoot.status, 200, "in-root file should be readable");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── 3. Confirmation actor guard ──────────────────────────────────────────────

test("guarded confirmation: only the initiator can answer", async () => {
  const store = new ConfirmationPendingStore();
  const { correlationId, promise } = store.create({ timeoutMs: 5000, guardActorId: 111 });

  // A different user cannot resolve it, and the entry survives their attempt.
  assert.equal(store.isActorAllowed(correlationId, 999), false);
  assert.equal(store.resolve(correlationId, true, 999), false);

  // The initiator can, and the promise resolves to their answer.
  assert.equal(store.isActorAllowed(correlationId, 111), true);
  assert.equal(store.resolve(correlationId, true, 111), true);
  assert.equal(await promise, true);
});

test("unguarded confirmation stays backward-compatible (web/terminal path)", async () => {
  const store = new ConfirmationPendingStore();
  const { correlationId, promise } = store.create({ timeoutMs: 5000 }); // no guard
  // Legacy 2-arg resolve (api/confirm.js) still works.
  assert.equal(store.resolve(correlationId, false), true);
  assert.equal(await promise, false);
});

// ── 4. SSRF guard ────────────────────────────────────────────────────────────

test("http fetch tool blocks private / loopback / metadata targets", async () => {
  const blocked = [
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.0.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://[::1]/",
    "http://2130706433/", // decimal-encoded 127.0.0.1
  ];
  for (const url of blocked) {
    await assert.rejects(
      () => http_get({ url }),
      /private or link-local|Could not resolve/i,
      `${url} should be refused`
    );
  }
});

test("http fetch tool rejects non-http protocols", async () => {
  await assert.rejects(() => http_get({ url: "file:///etc/passwd" }), /not allowed/i);
});
