// `GET /agents` — every agent in every project, in one request.
//
// The phone's Directory is a directory OF this. It cannot be built from the
// inbox: the inbox lists CONVERSATIONS, so it only carries agents somebody has
// already written to, and it knows nothing about an agent's area, its place in
// the tree, or what its prompt says. The agent you open a directory to find is
// precisely the one the inbox has no row for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(roots) {
  const projects = new ProjectManager({});
  const ids = roots.map((r) => projects.register(r).id);
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
  return { app, ids };
}

const LONG_PROMPT = `# Arquitecto\n\n${"Diseña la arquitectura y documenta los tradeoffs. ".repeat(40)}`;

test("the directory spans projects and says which one each agent lives in", async () => {
  const a = makeTempProject({
    name: "Uno",
    agents: [
      { slug: "zoya", role: "CEO", model: "mock:test" },
      { slug: "arch", role: "Software Architect", model: "mock:test" },
    ],
  });
  const b = makeTempProject({ name: "Dos", agents: [{ slug: "romi", role: "Editor", model: "mock:test" }] });
  const { app, ids } = makeApp([a, b]);
  const { server, baseUrl } = await listen(app);
  try {
    const rows = await fetch(`${baseUrl}/api/agents`).then((r) => r.json());
    const slugs = rows.map((r) => r.slug).sort();
    assert.deepEqual(slugs, ["arch", "romi", "zoya"]);

    const arch = rows.find((r) => r.slug === "arch");
    assert.equal(arch.project_id, ids[0]);
    assert.equal(arch.project_name, "Uno");
    assert.ok(arch.project_path, "a row carries the path too, for the panel's links");
    assert.equal(arch.role, "Software Architect", "and the card fields a list draws with");

    const romi = rows.find((r) => r.slug === "romi");
    assert.equal(romi.project_id, ids[1], "an agent is not listed under the wrong project");
  } finally {
    server.close();
    cleanupTempProject(a);
    cleanupTempProject(b);
  }
});

test("each row carries the TOP of the prompt, clipped, and says when there is more", async () => {
  // Without this a directory row cannot say what an agent is for, and the only
  // alternative is one detail request per agent — 68 of them on this machine.
  const root = makeTempProject({
    name: "Uno",
    agents: [{ slug: "arch", role: "Arquitecto", model: "mock:test", body: LONG_PROMPT }],
  });
  const { app } = makeApp([root]);
  const { server, baseUrl } = await listen(app);
  try {
    const [row] = await fetch(`${baseUrl}/api/agents`).then((r) => r.json());
    assert.ok(row.system_preview.length > 0, "there is a preview");
    assert.ok(row.system_preview.length < 400, `the preview is clipped, got ${row.system_preview.length}`);
    assert.ok(row.system_bytes > row.system_preview.length, "and it says how much prompt there is");
    assert.equal(row.system_more, true, "so the detail is worth fetching");
    assert.ok(!row.system_preview.includes("Diseña la arquitectura y documenta los tradeoffs. ".repeat(20)));
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("a short prompt is not advertised as having more", async () => {
  const root = makeTempProject({
    name: "Uno",
    agents: [{ slug: "romi", role: "Editor", model: "mock:test", body: "# Romi\n\nEditás reels." }],
  });
  const { app } = makeApp([root]);
  const { server, baseUrl } = await listen(app);
  try {
    const [row] = await fetch(`${baseUrl}/api/agents`).then((r) => r.json());
    assert.equal(row.system_more, false);
    assert.match(row.system_preview, /Editás reels/);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("a project that cannot be read is skipped, not fatal", async () => {
  // One project whose folder moved must not blank out the whole directory —
  // the same rule the inbox carries.
  const good = makeTempProject({ name: "Uno", agents: [{ slug: "zoya", role: "CEO", model: "mock:test" }] });
  const gone = makeTempProject({ name: "Dos", agents: [] });
  const { app } = makeApp([good, gone]);
  cleanupTempProject(gone);
  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/api/agents`);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(rows.some((r) => r.slug === "zoya"), "the readable project is still listed");
  } finally {
    server.close();
    cleanupTempProject(good);
  }
});
