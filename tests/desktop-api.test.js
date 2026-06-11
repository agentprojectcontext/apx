import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { desktopClients } from "#host/daemon/desktop-ws.js";
import desktopPlugin from "#host/daemon/plugins/desktop/index.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeApp({ instances = new Map() } = {}) {
  const projects = new ProjectManager({});
  const plugins = {
    instances,
    get: () => null,
    status: () => ({}),
  };
  return buildApi({
    projects,
    registries: null,
    plugins,
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
}

test("GET /desktop/status reports the live connected-client count", async () => {
  const { server, baseUrl } = await listen(makeApp());
  const fake = { readyState: 1, on() {}, send() {} };
  desktopClients.add(fake);
  try {
    const res = await fetch(`${baseUrl}/desktop/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.connected_clients >= 1);
  } finally {
    desktopClients.delete(fake);
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /desktop/message requires text", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/desktop/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "text required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /desktop/message acks immediately and routes to the desktop plugin", async () => {
  let resolveCalled;
  const called = new Promise((r) => (resolveCalled = r));
  const instances = new Map([
    [
      "desktop",
      {
        handleMessage(payload) {
          resolveCalled(payload);
        },
      },
    ],
  ]);
  const { server, baseUrl } = await listen(makeApp({ instances }));
  try {
    const res = await fetch(`${baseUrl}/desktop/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hola", previousMessages: [{ role: "user", content: "x" }] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const payload = await called;
    assert.equal(payload.text, "hola");
    assert.deepEqual(payload.previousMessages, [{ role: "user", content: "x" }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Desktop plugin — config resolution and the disabled guard.
// ---------------------------------------------------------------------------

function initPlugin(config) {
  return desktopPlugin.init({
    projects: new ProjectManager({}),
    config,
    log: () => {},
    plugins: { instances: new Map() },
  });
}

test("desktop plugin is enabled by default", () => {
  const inst = initPlugin({});
  assert.equal(inst.status().enabled, true);
});

test("desktop plugin reads the legacy 'overlay' config block as a fallback", () => {
  const inst = initPlugin({ overlay: { enabled: false } });
  assert.equal(inst.status().enabled, false);
});

test("the 'desktop' config block wins over the legacy 'overlay' block", () => {
  const inst = initPlugin({ desktop: { enabled: true }, overlay: { enabled: false } });
  assert.equal(inst.status().enabled, true);
});

test("handleMessage rejects when the plugin is disabled", async () => {
  const inst = initPlugin({ desktop: { enabled: false } });
  await assert.rejects(
    () => inst.handleMessage({ text: "hi" }),
    /not enabled/
  );
});

// ── Autostart endpoints (shared with `apx desktop install/uninstall`) ───

test("GET /desktop/autostart returns {ok, enabled:boolean, platform}", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/desktop/autostart`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.enabled, "boolean");
    assert.equal(body.platform, process.platform);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /desktop/autostart requires {enable: boolean}", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(`${baseUrl}/desktop/autostart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /enable must be a boolean/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
