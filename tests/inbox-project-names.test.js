// A row says which project it comes from BY NAME, or it says nothing useful.
//
// THE BUG THIS EXISTS FOR. A super-agent row knows which project its
// conversation belongs to — a web day written inside project 4 is not project
// 0's thread to read, and getting that wrong is a 404 over an empty pane. But
// the store that builds the row has no project registry to name it with, so it
// shipped `project_name: null` beside a bare id, and the badge fell back to
// printing the id. The phone spent a day showing Roby's chat tagged "4":
// "¿qué pasó con Roby que ahora se llama 4? Es como que default o Roby dice 4
// en varios lados" (Manu, 2026-09-20).
//
// It reads as a bug in the agent, not in a label — which is exactly how much
// damage an unresolved id does on a screen.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// APX_HOME before ANY #core import: the global ledger and the ProjectManager's
// storagePath both hang off it, and a test that seeds without this writes into
// the real ~/.apx.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-inbox-names-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { appendGlobalMessage } = await import("#core/stores/messages.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/** A web day the owner and the super-agent spent inside one project. */
function seedWebDay(projectId, day) {
  appendGlobalMessage({
    channel: "web", direction: "in", type: "user", author: "owner",
    body: "dale con los reels", ts: `${day}T10:00:00Z`, meta: { project_id: String(projectId) },
  });
  appendGlobalMessage({
    channel: "web", direction: "out", type: "agent", agent_slug: "super_agent",
    body: "listo", ts: `${day}T10:01:00Z`, meta: { project_id: String(projectId) },
  });
}

test("the super-agent's row names the project it was written in, never its id", async () => {
  const root = makeTempProject({ name: "tecnomanu", agents: [] });
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
    config: { host: "127.0.0.1", port: 7430, super_agent: { permission_mode: "total" } },
    token: "",
  });
  const { server, baseUrl } = await listen(app);
  try {
    seedWebDay(id, "2026-09-20");
    const body = await fetch(`${baseUrl}/api/inbox`).then((r) => r.json());
    const rows = body.data ?? body.items ?? body;
    const web = rows.find((r) => r.kind === "super_agent" && r.channel === "web");
    assert.ok(web, "the web day is a row");
    // It knows WHERE, which is what makes it openable at all…
    assert.equal(String(web.project_id), String(id));
    // …and now it also knows what that place is CALLED.
    assert.equal(web.project_name, "tecnomanu");
    assert.notEqual(web.project_name, String(id), "a bare id on a badge is the bug");
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("a row with no project of its own is left alone", async () => {
  // Telegram, the log and the desktop write one daemon-wide channel with no
  // project stamp. Those resolve to the default workspace, which wears no badge
  // at all — so nothing here may invent a name for them.
  const root = makeTempProject({ name: "tecnomanu", agents: [] });
  const projects = new ProjectManager({});
  projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { permission_mode: "total" } },
    token: "",
  });
  const { server, baseUrl } = await listen(app);
  try {
    appendGlobalMessage({
      channel: "telegram", direction: "in", type: "user", author: "owner",
      body: "che", ts: "2026-09-20T11:00:00Z",
    });
    const body = await fetch(`${baseUrl}/api/inbox`).then((r) => r.json());
    const rows = body.data ?? body.items ?? body;
    const tg = rows.find((r) => r.kind === "super_agent" && r.channel === "telegram");
    assert.ok(tg, "the telegram thread is a row");
    assert.equal(String(tg.project_id), "0", "unstamped belongs to the default workspace");
    // Whatever it carries, it must not be another project's name.
    assert.notEqual(tg.project_name, "tecnomanu");
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});
