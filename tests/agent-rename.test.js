// Renaming an agent's slug — the slug is the agent's physical key, so a rename
// must move its .apc/agents/<slug>.md and its runtime dir (memory) AND repoint
// every LIVE pointer to it — child `Parent`, routine `spec.agent`, group
// rosters (here and in rooms hosted by another project), tasks, the delivery
// queue, code sessions, telegram routing and the project's own .apc/config.json
// — or it leaves dangling pointers: an agent that keeps its chats but silently
// falls out of its rooms, its channel and its queue. This pins the whole move
// through the real HTTP route.
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
const { createGroupThread, listProjectGroupThreads } = await import("#core/stores/messages.js");
const { createTask, listTasks } = await import("#core/stores/tasks.js");
const { recordDelivery, markDelivery, listDeliveries, DELIVERY_STATUS } =
  await import("#core/stores/deliveries.js");
const { createCodeSession, getCodeSession } = await import("#core/stores/code-sessions.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root, extraRoots = []) {
  const projects = new ProjectManager({});
  projects.register(root);
  for (const extra of extraRoots) projects.register(extra);
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

test("rename repoints groups, tasks, deliveries, code sessions, telegram and .apc/config.json", async () => {
  const root = makeTempProject({});
  const other = makeTempProject({ name: "northwind" });
  const { app, projects } = makeApp(root, [other]);
  const { server, baseUrl } = await listen(app);
  try {
    const pid = await pidFor(baseUrl, root);
    const p = projects.get(pid);
    const q = projects.getByPath(other);
    const store = p.storagePath || p.path;

    // Both projects own an agent called "nati" — the sweep must repoint OURS
    // and leave the other project's alone, or a rename in one project would
    // reach into another's rooms and routes.
    for (const [base, slug] of [[pid, "nati"], [q.id, "nati"]]) {
      const r = await fetch(`${baseUrl}/api/projects/${base}/agents`, {
        method: "POST", headers: json,
        body: JSON.stringify({ slug, name: "Nati", system: "You are Nati." }),
      });
      assert.equal(r.status, 201);
    }

    upsertRoutine(store, { name: "nati-daily", kind: "exec_agent", schedule: "manual", spec: { agent: "nati" } });
    const gid = createGroupThread(p.logMessage, { participants: ["nati"], title: "Sala" });
    // Hosted by the OTHER project, but this agent's home is here → repointed.
    const guestGid = createGroupThread(q.logMessage, {
      participants: ["nati"], title: "Cross", homes: { nati: pid },
    });
    // The other project's OWN nati (no homes map → host's roster) → untouched.
    const foreignGid = createGroupThread(q.logMessage, { participants: ["nati"], title: "Suya" });
    const task = createTask(store, { title: "Escribir el brief", agent: "nati" });
    const did = recordDelivery(store, { agent: "nati", agentName: "Nati", routine: "nati-daily", notify: "x" });
    markDelivery(store, did, DELIVERY_STATUS.NOTIFIED);
    const session = createCodeSession(store, { projectId: pid, title: "spike", agentSlug: "nati" });

    // Telegram: one channel on this project, one on the other, same slug.
    const cfg = readConfig();
    writeConfig({
      ...cfg,
      telegram: {
        ...cfg.telegram,
        channels: [
          { name: "acme", bot_token: "t", chat_id: "1234567890", route_to_agent: "nati", project: root },
          { name: "northwind", bot_token: "t", chat_id: "1234567891", route_to_agent: "nati", project: other },
        ],
      },
    });
    const apcCfg = path.join(root, ".apc", "config.json");
    fs.writeFileSync(apcCfg, JSON.stringify({
      telegram: { route_to_agent: "nati" },
      routines: [{ name: "morning", schedule: "0 9 * * *", agent: "nati", prompt: "hi" }],
    }, null, 2));

    const r = await fetch(`${baseUrl}/api/projects/${pid}/agents/nati/rename`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "vera" }),
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));

    assert.equal(listRoutines(store).find((x) => x.name === "nati-daily").spec.agent, "vera");

    const rooms = listProjectGroupThreads(store);
    assert.deepEqual(rooms.find((t) => t.id === gid).participants, ["vera"]);

    const guestRooms = listProjectGroupThreads(q.storagePath || q.path);
    const guest = guestRooms.find((t) => t.id === guestGid);
    assert.deepEqual(guest.participants, ["vera"]);
    assert.deepEqual(guest.homes, { vera: pid });
    // The other project's own agent kept its slug and its room.
    assert.deepEqual(guestRooms.find((t) => t.id === foreignGid).participants, ["nati"]);
    assert.equal((await fetch(`${baseUrl}/api/projects/${q.id}/agents/nati`)).status, 200);

    assert.equal(listTasks(store, { state: "all" }).find((t) => t.id === task.id).agent, "vera");

    const delivery = listDeliveries(store).find((d) => d.id === did);
    assert.equal(delivery.agent, "vera");
    // Repointing must not rewind the queue: it was notified, it stays notified.
    assert.equal(delivery.status, DELIVERY_STATUS.NOTIFIED);

    assert.equal(getCodeSession(store, session.id).agentSlug, "vera");

    const after = readConfig();
    assert.equal(after.telegram.channels.find((c) => c.name === "acme").route_to_agent, "vera");
    assert.equal(after.telegram.channels.find((c) => c.name === "northwind").route_to_agent, "nati");

    const apc = JSON.parse(fs.readFileSync(apcCfg, "utf8"));
    assert.equal(apc.telegram.route_to_agent, "vera");
    assert.equal(apc.routines[0].agent, "vera");
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
    cleanupTempProject(other);
  }
});

test("renaming an imported vault agent leaves no ghost under the old slug", async () => {
  const root = makeTempProject({});
  const { app } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const pid = await pidFor(baseUrl, root);

    // The shape a vault import leaves behind: NO local .apc/agents/<slug>.md —
    // the roster resolves the agent through `agents.imported` (what `apx agent
    // import` and the import_agent tool write). Renaming used to materialize
    // the new slug locally and leave this entry pointing at the vault, so the
    // same agent came back as a second card.
    const projectFile = path.join(root, ".apc", "project.json");
    const meta = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    meta.agents = { imported: ["tessa-qa"] };
    fs.writeFileSync(projectFile, JSON.stringify(meta, null, 2) + "\n");
    assert.ok(!fs.existsSync(path.join(root, ".apc", "agents", "tessa-qa.md")));

    let r = await fetch(`${baseUrl}/api/projects/${pid}/agents`);
    assert.deepEqual((await r.json()).map((a) => a.slug), ["tessa-qa"]);

    r = await fetch(`${baseUrl}/api/projects/${pid}/agents/tessa-qa/rename`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "nadia" }),
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));

    // One agent, under the new slug — not two.
    const roster = await (await fetch(`${baseUrl}/api/projects/${pid}/agents`)).json();
    assert.deepEqual(roster.map((a) => a.slug), ["nadia"]);
    assert.equal((await fetch(`${baseUrl}/api/projects/${pid}/agents/tessa-qa`)).status, 404);

    // Materialized locally, and the import entry that resurrected it is gone.
    assert.ok(fs.existsSync(path.join(root, ".apc", "agents", "nadia.md")));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(projectFile, "utf8")).agents.imported,
      [],
    );
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
