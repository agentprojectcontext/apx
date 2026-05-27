import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "../src/host/daemon/db.js";
import { buildApi } from "../src/host/daemon/api.js";
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
