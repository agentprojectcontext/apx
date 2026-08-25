// Renaming an agent's slug — the slug is the agent's physical key, so a rename
// must move its .apc/agents/<slug>.md and its runtime dir (memory) AND repoint
// every reference (child `Parent`, routine `spec.agent`) or it leaves dangling
// pointers. This pins the whole move through the real HTTP route.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-rename-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { upsertRoutine, listRoutines } = await import("#core/stores/routines.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root) {
  const projects = new ProjectManager({});
  projects.register(root);
  const app = buildApi({
    projects, registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { name: "apx" } },
    token: "",
  });
  return { app, projects };
}

async function pidFor(baseUrl, root) {
  const list = await (await fetch(`${baseUrl}/api/projects`)).json();
  const p = list.find((x) => x.path === root) || list[list.length - 1];
  return p.id;
}

const json = { "content-type": "application/json" };

test("rename moves the agent, its memory, and repoints child + routines", async () => {
  const root = makeTempProject({});
  const { app, projects } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const pid = await pidFor(baseUrl, root);
    const p = projects.get(pid);

    // Parent + child that reports to it, and a routine targeting the parent.
    let r = await fetch(`${baseUrl}/api/projects/${pid}/agents`, {
      method: "POST", headers: json,
      body: JSON.stringify({ slug: "nati", name: "Nati", role: "companion", system: "You are Nati." }),
    });
    assert.equal(r.status, 201);
    r = await fetch(`${baseUrl}/api/projects/${pid}/agents`, {
      method: "POST", headers: json,
      body: JSON.stringify({ slug: "helper", parent: "nati", system: "You help Nati." }),
    });
    assert.equal(r.status, 201);
    upsertRoutine(p.storagePath || p.path, {
      name: "nati-daily", kind: "exec_agent", schedule: "manual", spec: { agent: "nati" },
    });

    // Seed a memory line so we can prove the runtime dir travels.
    await fetch(`${baseUrl}/api/projects/${pid}/agents/nati/memory`, {
      method: "PUT", headers: json, body: JSON.stringify({ body: "# Nati\n- remembers this\n" }),
    });

    // Rename nati → candela-2.
    r = await fetch(`${baseUrl}/api/projects/${pid}/agents/nati/rename`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "candela-2" }),
    });
    const renamed = await r.json();
    assert.equal(r.status, 200, JSON.stringify(renamed));
    assert.equal(renamed.slug, "candela-2");

    // Old slug gone, new slug present.
    assert.equal((await fetch(`${baseUrl}/api/projects/${pid}/agents/nati`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/projects/${pid}/agents/candela-2`)).status, 200);

    // Definition file moved on disk.
    assert.ok(!fs.existsSync(path.join(root, ".apc", "agents", "nati.md")));
    assert.ok(fs.existsSync(path.join(root, ".apc", "agents", "candela-2.md")));

    // Memory travelled with the runtime dir.
    const mem = await (await fetch(`${baseUrl}/api/projects/${pid}/agents/candela-2/memory`)).json();
    assert.match(mem.body, /remembers this/);

    // Child repointed to the new parent slug.
    const child = await (await fetch(`${baseUrl}/api/projects/${pid}/agents/helper`)).json();
    assert.equal(child.parent, "candela-2");

    // Routine repointed.
    const routines = listRoutines(p.storagePath || p.path);
    assert.equal(routines.find((x) => x.name === "nati-daily").spec.agent, "candela-2");
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("rename rejects a taken slug and an invalid slug", async () => {
  const root = makeTempProject({});
  const { app } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const pid = await pidFor(baseUrl, root);
    for (const slug of ["one", "two"]) {
      const r = await fetch(`${baseUrl}/api/projects/${pid}/agents`, {
        method: "POST", headers: json, body: JSON.stringify({ slug, system: "x" }),
      });
      assert.equal(r.status, 201);
    }
    // Target already exists → 400, and "one" is untouched.
    let r = await fetch(`${baseUrl}/api/projects/${pid}/agents/one/rename`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "two" }),
    });
    assert.equal(r.status, 400);
    assert.equal((await fetch(`${baseUrl}/api/projects/${pid}/agents/one`)).status, 200);

    // Invalid slug shape → 400.
    r = await fetch(`${baseUrl}/api/projects/${pid}/agents/one/rename`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "1Bad Slug" }),
    });
    assert.equal(r.status, 400);

    // Renaming a missing agent → 404.
    r = await fetch(`${baseUrl}/api/projects/${pid}/agents/ghost/rename`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "whatever" }),
    });
    assert.equal(r.status, 404);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
