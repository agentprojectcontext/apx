// Project memory — `<repo>/.apc/memory.md` — and the `remember` scope that
// writes it.
//
// THE FAILURE THIS FIXES, from a real install: asked to record what each of a
// dozen projects was, the super-agent had no tool for project memory (it only
// had `remember`, which writes its own global notebook), so it improvised a
// `MEMORY.md` at each repo root and reported success. Nothing reads that file:
// not the Memories screen, which reads `.apc/memory.md`, and not the RAG
// indexer, which scopes the same path to `project:<id>`. The owner was told the
// memories were written and found every Memories screen unchanged.
//
// So the assertions that matter here are about the PATH: the file the tool
// writes has to be the file the screen reads, and nothing may appear at the
// repo root. Before the fix, the first test below fails with "note lands in the
// notebook" and `.apc/memory.md` never existing.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-projmem-"));
process.env.HOME = TMP_HOME;

const remember = (await import("#core/agent/tools/handlers/remember.js")).default;
const { readProjectMemory, writeProjectMemory, projectMemoryPath } =
  await import("#core/apc/project-memory.js");
const { readSelfMemory } = await import("#core/agent/self-memory.js");
const { apcMemoryFile } = await import("#core/apc/paths.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");

let ROOT, OTHER, projects;

beforeEach(() => {
  ROOT = makeTempProject({ name: "northwind" });
  OTHER = makeTempProject({ name: "acme" });
  const registry = [
    { id: 1, name: "northwind", path: ROOT },
    { id: 2, name: "acme", path: OTHER },
  ];
  projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
  try { fs.rmSync(path.join(TMP_HOME, ".apx", "memory.md")); } catch { /* first run */ }
});

const onWeb = (over = {}) => remember.makeHandler({ projects, channel: "web", ...over });

// --------------------------------------------------------------------------
// the note lands where the screen looks
// --------------------------------------------------------------------------

test("a note with a project lands in that project's .apc/memory.md", () => {
  const r = onWeb()({ note: "Northwind runs on Postgres in production", project: "northwind" });
  assert.equal(r.saved, true);
  assert.equal(r.scope, "project");
  assert.equal(r.project, "northwind");
  // The exact file the Memories screen and the RAG indexer read.
  assert.equal(r.path, apcMemoryFile(ROOT));
  assert.match(readProjectMemory(ROOT), /Postgres in production/);
});

test("nothing is written at the repo root — that was the invisible file", () => {
  onWeb()({ note: "Northwind is owned by the platform team", project: "northwind" });
  const stray = fs.readdirSync(ROOT).filter((f) => /^memory\.md$/i.test(f) || /^MEMORY\.md$/.test(f));
  assert.deepEqual(stray, [], "a memory file at the repo root is read by nothing");
});

test("a project note stays out of the global notebook", () => {
  onWeb()({ note: "Northwind ships every Thursday", project: "northwind" });
  assert.doesNotMatch(readSelfMemory(), /every Thursday/);
});

test("without a project the note still goes to the notebook", () => {
  const r = onWeb()({ note: "the owner prefers terse replies with no trailing summary" });
  assert.equal(r.saved, true);
  assert.equal(r.scope, undefined);
  assert.match(readSelfMemory(), /terse replies/);
  assert.equal(readProjectMemory(ROOT), "");
});

test("each project keeps its own memory", () => {
  onWeb()({ note: "Northwind is the warehouse app", project: "northwind" });
  onWeb()({ note: "Acme is the billing app", project: "acme" });
  assert.match(readProjectMemory(ROOT), /warehouse app/);
  assert.doesNotMatch(readProjectMemory(ROOT), /billing app/);
  assert.match(readProjectMemory(OTHER), /billing app/);
});

test("notes accumulate under one day heading instead of replacing each other", () => {
  onWeb()({ note: "the first durable fact about this project" });
  onWeb()({ note: "the first durable fact about this project", project: "northwind" });
  onWeb()({ note: "the second durable fact about this project", project: "northwind" });
  const body = readProjectMemory(ROOT);
  assert.match(body, /first durable fact/);
  assert.match(body, /second durable fact/);
  assert.equal(body.match(/^## \d{4}-\d{2}-\d{2}$/gm).length, 1);
  // Headed with the project's name so the file says what it is when someone
  // opens it in the repo rather than in APX.
  assert.match(body, /^# northwind — project memory/);
});

test("the note is tagged with the channel it arrived on", () => {
  onWeb({ channel: "telegram" })({ note: "a fact that arrived over telegram", project: "northwind" });
  assert.match(readProjectMemory(ROOT), /\[\d{2}:\d{2}\]\[telegram\]/);
});

test("an unknown project is an error, not a silent global save", () => {
  const r = onWeb()({ note: "a fact about a project that is not registered", project: "ghost" });
  assert.match(r.error || "", /not found/);
  assert.doesNotMatch(readSelfMemory(), /not registered/);
});

test("an explicit project beats the routine divert", () => {
  // Inside a routine a non-durable note is diverted to the routine's own
  // memory. An explicit project overrides that: the model said where it goes.
  const handler = remember.makeHandler({
    projects,
    channel: "routine",
    channelMeta: { routineId: "r_abc", routineName: "day-close", projectPath: ROOT },
  });
  const r = handler({ note: "today the deploy was green", project: "northwind" });
  assert.equal(r.scope, "project");
  assert.match(readProjectMemory(ROOT), /deploy was green/);
});

// --------------------------------------------------------------------------
// the screen reads and writes the same file
// --------------------------------------------------------------------------

test("the store round-trips a hand-written body", () => {
  writeProjectMemory(ROOT, "# northwind\n\nStack: Postgres, Redis.\n");
  assert.equal(projectMemoryPath(ROOT), apcMemoryFile(ROOT));
  assert.match(readProjectMemory(ROOT), /Stack: Postgres, Redis\./);
});

test("GET/PUT /projects/:pid/memory read the file the tool writes", async () => {
  const root = makeTempProject({ name: "contoso" });
  const registry = new ProjectManager({});
  registry.register(root);
  const app = buildApi({
    projects: registry,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { name: "apx" } },
    token: "",
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await (await fetch(`${baseUrl}/api/projects`)).json();
    const pid = (list.find((x) => x.path === root) || list[list.length - 1]).id;

    // What the tool wrote is what the screen shows.
    const projs = {
      list: () => [{ id: pid, name: "contoso", path: root }],
      get: () => ({ id: pid, name: "contoso", path: root }),
    };
    remember.makeHandler({ projects: projs, channel: "web" })(
      { note: "Contoso is the reporting service", project: String(pid) }
    );
    let r = await fetch(`${baseUrl}/api/projects/${pid}/memory`);
    const json = await r.json();
    assert.equal(r.status, 200);
    assert.equal(json.path, apcMemoryFile(root));
    assert.match(json.body, /reporting service/);

    // And what the screen saves is what the tool reads back.
    r = await fetch(`${baseUrl}/api/projects/${pid}/memory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# contoso\n\nEdited by hand.\n" }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.match(readProjectMemory(root), /Edited by hand\./);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test.after(() => {
  cleanupTempProject(ROOT);
  cleanupTempProject(OTHER);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});
