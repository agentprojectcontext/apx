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
    const res = await fetch(`${baseUrl}/api/health`); // no Authorization header
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
    const res = await fetch(`${baseUrl}/api/projects`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an API route rejects a wrong bearer token", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/api/projects`, {
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
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every GET outside /api is public panel surface; /api is the wall", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    // No token: bundle assets, known client-router routes, and routes the
    // router does NOT know all fall through to the SPA fallback, never the
    // auth wall. The unknown one used to 401 here, on the theory that it might
    // be a data route — it cannot be one since every data route moved under
    // /api, and answering 401 meant a typo'd URL showed a JSON error instead
    // of the styled NotFound screen (e2e/06-not-found.spec.ts).
    for (const p of ["/assets/app-abc123.js", "/settings", "/some/unknown/route"]) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.notEqual(res.status, 401, `${p} should pass the auth wall`);
    }
    // The unknown one still says 404 — public does not mean pretending it exists.
    assert.equal((await fetch(`${baseUrl}/some/unknown/route`)).status, 404);
    // And the wall itself is intact: an /api data route without a token is 401.
    const guarded = await fetch(`${baseUrl}/api/skills`);
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
