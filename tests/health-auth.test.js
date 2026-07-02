import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";

const TOKEN = "s3cret-token";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeApp() {
  return buildApi({
    projects: new ProjectManager({}),
    registries: null,
    plugins: { instances: new Map(), get: () => null, status: () => ({}) },
    scheduler: null,
    version: "9.9.9",
    startedAt: Date.now() - 5000,
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: TOKEN,
  });
}

test("GET /health is unauthenticated and reports version + uptime", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/health`); // no Authorization header
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.version, "9.9.9");
    assert.ok(body.uptime_s >= 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an API route rejects requests without a bearer token", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/projects`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an API route rejects a wrong bearer token", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/projects`, {
      headers: { authorization: "Bearer nope" },
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an API route accepts the correct bearer token", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/projects`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET passthrough is scoped to static assets and known SPA routes", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    // No token: genuine bundle assets (extension) and known client-router routes
    // fall through to the SPA / 404, never the auth wall.
    for (const p of ["/assets/app-abc123.js", "/settings"]) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.notEqual(res.status, 401, `${p} should pass the auth wall`);
    }
    // But an unknown, extension-less GET is treated as a potential data route
    // and MUST require a token — the hardened allowlist (no more denylist drift).
    const guarded = await fetch(`${baseUrl}/some/unknown/route`);
    assert.equal(guarded.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("non-GET requests to non-API paths still require auth", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/some/spa/route`, { method: "POST" });
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
