import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test("GET /deck/manifest exposes APX Deck bootstrap data", async () => {
  const root = makeTempProject({
    name: "Deck Project",
    agents: [{ slug: "builder", role: "Builds things" }],
  });
  const projects = new ProjectManager({});
  projects.register(root);

  const plugins = {
    get() {
      return null;
    },
    status() {
      return { telegram: { enabled: true, running: true } };
    },
  };

  const app = buildApi({
    projects,
    registries: null,
    plugins,
    scheduler: null,
    version: "test",
    startedAt: Date.now() - 1500,
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });

  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/deck/manifest`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.status, "ok");
    assert.equal(body.daemon.name, "apx");
    assert.equal(body.daemon.port, 7430);
    assert.equal(body.deck.name, "apx-deck");
    assert.ok(body.deck.desktops.find((desktop) => desktop.id === "project"));
    assert.ok(body.deck.widgets.find((widget) => widget.id === "apx-current-project"));
    assert.ok(body.deck.widgets.find((widget) => widget.id === "docker"));
    assert.equal(body.apx.active_project.name, "Deck Project");
    assert.equal(body.apx.projects[0].agents, 1);
    assert.equal(body.apx.plugins.telegram.running, true);
    assert.equal(body.safety.dangerous_actions_require_confirmation, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanupTempProject(root);
  }
});

test("PATCH /deck/widgets/:id persists enable/disable into the manifest", async () => {
  const root = makeTempProject({ name: "Toggle Project" });
  const projects = new ProjectManager({});
  projects.register(root);
  const cfg = { host: "127.0.0.1", port: 7430 };
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: cfg,
    token: "",
  });

  const { server, baseUrl } = await listen(app);
  try {
    const patchRes = await fetch(`${baseUrl}/deck/widgets/docker`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.id, "docker");
    assert.equal(patched.enabled, false);

    const manifest = await (await fetch(`${baseUrl}/deck/manifest`)).json();
    const docker = manifest.deck.widgets.find((w) => w.id === "docker");
    assert.equal(docker.status, "disabled");
    assert.equal(docker.user_enabled, false);

    const bad = await fetch(`${baseUrl}/deck/widgets/nonsense-xx`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(bad.status, 404);

    const bad2 = await fetch(`${baseUrl}/deck/widgets/docker`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    assert.equal(bad2.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanupTempProject(root);
  }
});
