// A project whose folder was renamed or moved must SAY so, and must be
// repairable without losing its id.
//
// The regression: `/proyectos_varios/knot` was renamed to `/proyectos_varios/cheto`.
// A project is registered by path and nothing else, so every derived fact fell
// back instead of failing — the name became the basename of the dead path
// ("knot", though .apc/project.json said "Cheto"), readAgents() found no
// directory and answered 0 though there were eight, and `apx project rebuild 18`
// reported "Rebuilt project #18: 0 agents" and exited 0. Nothing anywhere
// errored, so the only reading available was that the rename had reverted.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-projmissing-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
// APX_HOME and not HOME alone: the runner overrides HOME with its own APX_HOME.
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { projectPresence, findMovedProject } = await import("#core/apc/project-presence.js");

// Projects live in a sandbox of this test's own, not in os.tmpdir(): the
// moved-folder lookup scans the SIBLINGS of the old path, and a shared temp dir
// holds thousands of them. Owning the parent keeps the search bounded, keeps
// the neighbours known (a decoy only counts if we put it there), and keeps
// these tests from taking seconds apiece.
const SANDBOX = fs.mkdtempSync(path.join(TMP_HOME, "workspace-"));
let counter = 0;

/** A minimal APC project: what register() and readAgents() actually need. */
function mkProject(name, { agents = [], apxId } = {}) {
  const root = path.join(SANDBOX, `${name.toLowerCase()}-${++counter}`);
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({
      name,
      version: "0.1.0",
      apf: "0.1.0",
      apx_id: apxId || `test${String(counter).padStart(8, "0")}`,
    }, null, 2),
  );
  // AGENTS.md too: `addProject` (the config-file half) requires it. relinkProject
  // deliberately does NOT — see below.
  fs.writeFileSync(path.join(root, "AGENTS.md"), `# ${name}\n\nRules.\n`);
  for (const slug of agents) {
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${slug}.md`),
      `---\nname: ${slug}\nmodel: mock:test\ndescription: Test agent.\n---\n\n# ${slug}\nWork.\n`,
    );
  }
  return root;
}

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

/** Rename a project's folder the way a person does in Finder. */
function renameFolder(from, to) {
  fs.renameSync(from, to);
  return to;
}

function registered(root) {
  const pm = new ProjectManager({});
  const entry = pm.register(root);
  return { pm, entry };
}

test("projectPresence tells a missing folder from a de-initialized one", () => {
  const root = mkProject("Cheto");
  try {
    assert.equal(projectPresence(root).missing, false);

    // Folder there, .apc/project.json gone — a stale registration, not a move.
    const meta = path.join(root, ".apc", "project.json");
    const saved = fs.readFileSync(meta);
    fs.unlinkSync(meta);
    const deinit = projectPresence(root);
    assert.equal(deinit.missing, true);
    assert.match(deinit.reason, /no \.apc\/project\.json/);
    fs.writeFileSync(meta, saved);

    // Folder gone entirely — the rename case.
    const moved = path.join(path.dirname(root), `${path.basename(root)}-moved`);
    renameFolder(root, moved);
    const gone = projectPresence(root);
    assert.equal(gone.missing, true);
    assert.match(gone.reason, /no longer exists/);
    rm(moved);
  } catch (e) {
    rm(root);
    throw e;
  }
});

test("list() marks the project whose folder is gone", () => {
  const root = mkProject("Cheto", { agents: ["orchestrator"] });
  const moved = path.join(path.dirname(root), "cheto-renamed");
  try {
    const { pm, entry } = registered(root);

    const before = pm.list().find((p) => p.id === entry.id);
    assert.equal(before.missing, false);
    assert.equal(before.name, "Cheto", "the name comes from .apc/project.json");
    assert.equal(before.agents, 1);

    renameFolder(root, moved);

    const after = pm.list().find((p) => p.id === entry.id);
    assert.equal(after.missing, true, "the row must not look ordinary");
    assert.match(after.missing_reason, /no longer exists/);
    // The old fallbacks still happen — there is nothing else to derive from —
    // which is exactly why the flag has to be there.
    assert.equal(after.agents, 0);
    assert.equal(after.name, path.basename(root), "falls back to the dead path's basename");
  } finally {
    rm(root);
    rm(moved);
  }
});

test("rebuild FAILS on a missing folder instead of reporting 0 agents", () => {
  const root = mkProject("Cheto", { agents: ["pm"] });
  const moved = path.join(path.dirname(root), "cheto-rebuild");
  try {
    const { pm, entry } = registered(root);
    assert.equal(pm.rebuild(entry.id).agents, 1);

    renameFolder(root, moved);

    assert.throws(
      () => pm.rebuild(entry.id),
      (e) => {
        assert.match(e.message, /cannot rebuild/i);
        assert.match(e.message, /no longer exists/);
        // The message has to carry the way out, with the id in it.
        assert.match(e.message, /relink/);
        return true;
      },
      "a rebuild over a folder that is not there must not succeed",
    );
  } finally {
    rm(root);
    rm(moved);
  }
});

test("findMovedProject follows the apx_id, not the name", () => {
  const root = mkProject("Cheto");
  const moved = path.join(path.dirname(root), "renamed-to-something-else");
  const decoy = mkProject("Cheto"); // same NAME, different apx_id
  try {
    const apxId = JSON.parse(
      fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"),
    ).apx_id;

    renameFolder(root, moved);

    const found = findMovedProject(root, apxId);
    assert.ok(found, "the renamed folder is a sibling of the old path");
    assert.equal(found.path, moved);
    assert.equal(found.name, "Cheto");
    assert.notEqual(found.path, decoy, "a same-named project must not match");

    // No apx_id to match on = no guess at all.
    assert.equal(findMovedProject(root, null), null);
    // An id nothing carries finds nothing, rather than the nearest folder.
    assert.equal(findMovedProject(root, "ffffffffffff"), null);
  } finally {
    rm(moved);
    rm(decoy);
  }
});

test("relink keeps the id and the storage, and finds the folder on its own", () => {
  const root = mkProject("Cheto", { agents: ["qa", "pm"] });
  const moved = path.join(path.dirname(root), "cheto-relinked");
  try {
    const { pm, entry } = registered(root);
    const idBefore = entry.id;
    const storageBefore = entry.storagePath;
    const apxBefore = entry.apxId;

    renameFolder(root, moved);
    assert.equal(pm.findMoved(idBefore).path, moved, "the daemon can locate it");

    const result = pm.relink(idBefore, moved);
    assert.equal(result.id, idBefore, "THE ID SURVIVES — that is the whole point");
    assert.equal(result.from, root);
    assert.equal(result.path, moved);
    assert.equal(result.agents, 2, "the agents are readable again");

    const after = pm.list().find((p) => p.id === idBefore);
    assert.equal(after.missing, false);
    assert.equal(after.name, "Cheto", "the real name is back");
    assert.equal(after.storage_path, storageBefore, "stored data is not orphaned");
    assert.equal(after.apx_id, apxBefore);

    // The lookup maps moved with it: the old path must not still resolve.
    assert.equal(pm.getByPath(moved)?.id, idBefore);
    assert.equal(pm.getByPath(root), null);
    // And a rebuild works again.
    assert.equal(pm.rebuild(idBefore).agents, 2);
  } finally {
    rm(root);
    rm(moved);
  }
});

test("relink refuses a folder that is a different project", () => {
  const root = mkProject("Cheto");
  const other = mkProject("Otro");
  const moved = path.join(path.dirname(root), "cheto-guard");
  try {
    const { pm, entry } = registered(root);
    renameFolder(root, moved);

    assert.throws(
      () => pm.relink(entry.id, other),
      /different project/i,
      "pointing a project at somebody else's apx_id would read storage it never wrote",
    );
    // Explicitly asked for, it is allowed — the re-initialized case.
    const forced = pm.relink(entry.id, other, { force: true });
    assert.equal(forced.id, entry.id);
    assert.equal(forced.path, other);
  } finally {
    rm(root);
    rm(other);
    rm(moved);
  }
});

test("relink refuses a folder that is not a project, or one already registered", () => {
  const a = mkProject("A");
  const b = mkProject("B");
  const plain = fs.mkdtempSync(path.join(SANDBOX, "plain-"));
  try {
    const pm = new ProjectManager({});
    const one = pm.register(a);
    pm.register(b);

    assert.throws(() => pm.relink(one.id, plain), /no \.apc\/project\.json/);
    assert.throws(() => pm.relink(one.id, b), /already registered/);
    assert.throws(() => pm.relink(999, a), /unknown project id/);
    // None of the refusals may have moved anything.
    assert.equal(pm.get(one.id).path, a);
  } finally {
    rm(a);
    rm(b);
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

// ── the HTTP surface: what the panel and the CLI actually call ──────────────

const { buildApi } = await import("#host/daemon/api.js");
const { readConfig, addProject, relinkProject } = await import("#core/config/index.js");

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function apiFor(projects, { relinkProjectGlobally = () => true } = {}) {
  return buildApi({
    projects,
    registries: { ensure: () => {} },
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    removeProjectGlobally: () => {},
    relinkProjectGlobally,
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
}

test("GET /projects carries the missing flag the panel draws its warning from", async () => {
  const root = mkProject("Cheto", { agents: ["pm"] });
  const moved = path.join(path.dirname(root), "cheto-api");
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const { server, baseUrl } = await listen(apiFor(projects));
  try {
    const before = (await (await fetch(`${baseUrl}/api/projects`)).json()).find((p) => p.id === id);
    assert.equal(before.missing, false);

    renameFolder(root, moved);

    const after = (await (await fetch(`${baseUrl}/api/projects`)).json()).find((p) => p.id === id);
    assert.equal(after.missing, true);
    assert.match(after.missing_reason, /no longer exists/);
  } finally {
    server.close();
    rm(root);
    rm(moved);
  }
});

test("POST /projects/:id/rebuild answers 400, not a cheerful 0 agents", async () => {
  const root = mkProject("Cheto");
  const moved = path.join(path.dirname(root), "cheto-rebuild-api");
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const { server, baseUrl } = await listen(apiFor(projects));
  try {
    renameFolder(root, moved);
    const res = await fetch(`${baseUrl}/api/projects/${id}/rebuild`, { method: "POST" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /cannot rebuild/i);
    assert.match(body.error, /relink/);
  } finally {
    server.close();
    rm(root);
    rm(moved);
  }
});

test("POST /projects/:id/relink finds the folder itself and persists the move", async () => {
  const root = mkProject("Cheto", { agents: ["qa"] });
  const moved = path.join(path.dirname(root), "cheto-found");
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const persisted = [];
  const { server, baseUrl } = await listen(
    apiFor(projects, { relinkProjectGlobally: (from, to) => (persisted.push([from, to]), true) }),
  );
  try {
    renameFolder(root, moved);

    // No body at all: the daemon matches the apx_id among the siblings.
    const res = await fetch(`${baseUrl}/api/projects/${id}/relink`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id, "the id is what the whole repair is for");
    assert.equal(body.path, moved);
    assert.equal(body.agents, 1);
    assert.equal(body.persisted, true);
    assert.deepEqual(persisted, [[root, moved]], "persisted by PATH, old → new");

    const row = (await (await fetch(`${baseUrl}/api/projects`)).json()).find((p) => p.id === id);
    assert.equal(row.missing, false);
    assert.equal(row.name, "Cheto");
  } finally {
    server.close();
    rm(root);
    rm(moved);
  }
});

test("relink says so when it cannot find where the project went", async () => {
  const root = mkProject("Cheto");
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const { server, baseUrl } = await listen(apiFor(projects));
  try {
    rm(root); // deleted, not moved — there is nothing to find

    const res = await fetch(`${baseUrl}/api/projects/${id}/relink`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /could not find where/i);
  } finally {
    server.close();
  }
});

test("relinkProject rewrites the config entry IN PLACE, keeping its position", () => {
  const first = mkProject("First");
  const root = mkProject("Cheto");
  const last = mkProject("Last");
  const moved = path.join(path.dirname(root), "cheto-config");
  try {
    for (const p of [first, root, last]) addProject(readConfig(), p);
    const posBefore = readConfig().projects.findIndex((p) => path.resolve(p.path) === root);

    renameFolder(root, moved);
    const out = relinkProject(readConfig(), root, moved);
    assert.equal(out.relinked, true);

    const after = readConfig().projects;
    // Position is identity here: the daemon's project id is the entry's place in
    // this array, so a splice would renumber everything after it.
    assert.equal(after.findIndex((p) => path.resolve(p.path) === moved), posBefore);
    assert.equal(after.filter((p) => path.resolve(p.path) === moved).length, 1, "no duplicate");
    assert.equal(after.some((p) => path.resolve(p.path) === root), false, "old path gone");
    assert.equal(path.resolve(after[0].path), first, "its neighbours did not move");

    // Deliberate asymmetry with addProject, which also demands AGENTS.md: a
    // project that lost its AGENTS.md is a different problem, and refusing to
    // reattach it here would leave the user with no way back at all.
    const noRules = mkProject("NoRules");
    fs.rmSync(path.join(noRules, "AGENTS.md"));
    const noRulesMoved = path.join(path.dirname(noRules), "norules-moved");
    addProject(readConfig(), last); // a registered neighbour to relink away from
    renameFolder(noRules, noRulesMoved);
    assert.doesNotThrow(() => relinkProject(readConfig(), noRules, noRulesMoved));
    rm(noRulesMoved);
  } finally {
    rm(first);
    rm(last);
    rm(moved);
  }
});

test("the daemon hands the route a relinker that writes the file", () => {
  // Same contract check as its remove twin: the closure lives inside the boot
  // function, which cannot be imported without starting a daemon.
  const index = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "src/host/daemon/index.js"),
    "utf8",
  );
  assert.match(index, /relinkProject as relinkProjectInConfig/);
  assert.match(
    index,
    /relinkProjectGlobally: \(fromPath, toPath\) => \{[\s\S]*relinkProjectInConfig\(fresh, fromPath, toPath\)/,
    "and it re-reads the config first, like its add and remove twins",
  );
});
