// Agent emoji + autonomy (permission-mode) fields round-trip through the API
// and persist to the .apc/agents/<slug>.md frontmatter.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root) {
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
  return { app, id };
}

const json = { "content-type": "application/json" };

test("POST persists emoji + autonomy; GET returns them", async () => {
  const root = makeTempProject({});
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const r = await fetch(`${baseUrl}/api/projects/${id}/agents`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        slug: "roby", type: "orchestrator", area: "ops",
        emoji: "🤖", icon: "noche", autonomy: "total",
      }),
    });
    assert.equal(r.status, 201);
    const created = await r.json();
    assert.equal(created.emoji, "🤖");
    assert.equal(created.icon, "noche");
    assert.equal(created.autonomy, "total");
    assert.equal(created.type, "orchestrator");
    assert.equal(created.area, "ops");

    // Display names are stored as the org slug so Growth and growth don't split.
    const named = await fetch(`${baseUrl}/api/projects/${id}/agents`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ slug: "max", area: "Growth" }),
    });
    assert.equal(named.status, 201);
    assert.equal((await named.json()).area, "growth");
    const mdMax = fs.readFileSync(path.join(root, ".apc", "agents", "max.md"), "utf8");
    assert.match(mdMax, /^area:\s*growth\s*$/m);

    // Frontmatter written to the .apc file.
    const md = fs.readFileSync(path.join(root, ".apc", "agents", "roby.md"), "utf8");
    assert.match(md, /emoji: 🤖/);
    assert.match(md, /icon: noche/);
    assert.match(md, /autonomy: total/);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("GET slugifies a display-name Area already on disk", async () => {
  const root = makeTempProject({});
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "agents", "max.md"), [
    "---",
    "role: Marketing",
    "area: Growth",
    "---",
    "",
    "# Max",
    "",
  ].join("\n"));
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const list = await (await fetch(`${baseUrl}/api/projects/${id}/agents`)).json();
    assert.equal(list.find((a) => a.slug === "max").area, "growth");
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("PATCH updates autonomy and rejects an invalid value silently (keeps prior)", async () => {
  const root = makeTempProject({});
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    await fetch(`${baseUrl}/api/projects/${id}/agents`, {
      method: "POST", headers: json,
      body: JSON.stringify({ slug: "cody", autonomy: "permiso" }),
    });
    // Valid transition.
    let r = await fetch(`${baseUrl}/api/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ autonomy: "automatico" }),
    });
    assert.equal((await r.json()).autonomy, "automatico");
    // Bogus value is dropped — the prior value stands.
    r = await fetch(`${baseUrl}/api/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ autonomy: "yolo" }),
    });
    assert.equal((await r.json()).autonomy, "automatico");
    // Emoji can be cleared with an empty string.
    await fetch(`${baseUrl}/api/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ emoji: "🐼" }),
    });
    r = await fetch(`${baseUrl}/api/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ emoji: "" }),
    });
    assert.equal((await r.json()).emoji, null);
    // Blob icon round-trips through PATCH and can be cleared too.
    r = await fetch(`${baseUrl}/api/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ icon: "nimbo" }),
    });
    assert.equal((await r.json()).icon, "nimbo");
    r = await fetch(`${baseUrl}/api/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ icon: "" }),
    });
    assert.equal((await r.json()).icon, null);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
