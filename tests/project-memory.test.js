// A project's two memories, and the boundary between them.
//
//   curated  <repo>/.apc/memory.md          committed; only a person writes it
//   local    ~/.apx/projects/<id>/memory.md never committed; the agent writes it
//
// THE FAILURE THIS FIXES, from a real install: asked to record what each of a
// dozen projects was, the super-agent had no tool for project memory at all (it
// only had `remember`, which writes its own global notebook), so it improvised a
// `MEMORY.md` at each repo root and reported success. Nothing reads that file:
// not the Memories screen, not the RAG indexer. The owner was told the memories
// were written and found every screen unchanged.
//
// The obvious repair — point `remember` at `.apc/memory.md` — trades that bug
// for a worse one: an automatic writer aimed at a committed file is how a token
// pasted into a chat ends up in a public git history. APC says so itself, keeping
// private runtime memory in the runtime's own store and reserving `.apc/` for
// "curated project facts safe for the team". So the tool writes the local file,
// the screen shows both, and promotion is a person's move.
//
// The assertions that matter are therefore about WHICH FILE: the agent's note
// has to land where the screen looks, and never in the repo.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-projmem-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const remember = (await import("#core/agent/tools/handlers/remember.js")).default;
const { readProjectMemory, writeProjectMemory, projectMemoryPath } =
  await import("#core/apc/project-memory.js");
const { readProjectLocalMemory, projectLocalMemoryPath } =
  await import("#core/stores/project-memory.js");
const { readSelfMemory } = await import("#core/agent/self-memory.js");
const { apcMemoryFile } = await import("#core/apc/paths.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");

let ROOT, OTHER, STORE, OTHER_STORE, projects;

beforeEach(() => {
  ROOT = makeTempProject({ name: "northwind" });
  OTHER = makeTempProject({ name: "acme" });
  STORE = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  OTHER_STORE = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  const registry = [
    { id: 1, name: "northwind", path: ROOT, storagePath: STORE },
    { id: 2, name: "acme", path: OTHER, storagePath: OTHER_STORE },
  ];
  projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
  try { fs.rmSync(path.join(TMP_HOME, ".apx", "memory.md")); } catch { /* first run */ }
});

const onWeb = (over = {}) => remember.makeHandler({ projects, channel: "web", ...over });

// --------------------------------------------------------------------------
// the note lands where the screen looks — and nowhere else
// --------------------------------------------------------------------------

test("a note with a project lands in that project's local memory", () => {
  const r = onWeb()({ note: "Northwind runs on Postgres in production", project: "northwind" });
  assert.equal(r.saved, true);
  assert.equal(r.scope, "project");
  assert.equal(r.project, "northwind");
  assert.equal(r.path, path.join(STORE, "memory.md"));
  assert.equal(r.path, projectLocalMemoryPath({ storagePath: STORE }));
  assert.match(readProjectLocalMemory({ storagePath: STORE }), /Postgres in production/);
});

test("nothing is written at the repo root — that was the invisible file", () => {
  onWeb()({ note: "Northwind is owned by the platform team", project: "northwind" });
  const stray = fs.readdirSync(ROOT).filter((f) => /^memory\.md$/i.test(f));
  assert.deepEqual(stray, [], "a memory file at the repo root is read by nothing");
});

test("the committed .apc/memory.md is never written automatically", () => {
  // The safety boundary: whatever the agent picked up in a chat — including a
  // credential the owner pasted — must not reach a file git carries.
  onWeb()({ note: "the staging key is in the shared vault", project: "northwind" });
  assert.equal(fs.existsSync(apcMemoryFile(ROOT)), false);
  assert.equal(readProjectMemory(ROOT), "");
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
  assert.equal(readProjectLocalMemory({ storagePath: STORE }), "");
});

test("each project keeps its own memory", () => {
  onWeb()({ note: "Northwind is the warehouse app", project: "northwind" });
  onWeb()({ note: "Acme is the billing app", project: "acme" });
  assert.match(readProjectLocalMemory({ storagePath: STORE }), /warehouse app/);
  assert.doesNotMatch(readProjectLocalMemory({ storagePath: STORE }), /billing app/);
  assert.match(readProjectLocalMemory({ storagePath: OTHER_STORE }), /billing app/);
});

test("notes accumulate under one day heading instead of replacing each other", () => {
  onWeb()({ note: "the first durable fact about this project", project: "northwind" });
  onWeb()({ note: "the second durable fact about this project", project: "northwind" });
  const body = readProjectLocalMemory({ storagePath: STORE });
  assert.match(body, /first durable fact/);
  assert.match(body, /second durable fact/);
  assert.equal(body.match(/^## \d{4}-\d{2}-\d{2}$/gm).length, 1);
  // The header says what the file is — including that it is not committed,
  // which is the part someone opening it in a terminal needs to know.
  assert.match(body, /^# northwind — local memory \(not committed\)/);
});

test("the note is tagged with the channel it arrived on", () => {
  onWeb({ channel: "telegram" })({ note: "a fact that arrived over telegram", project: "northwind" });
  assert.match(readProjectLocalMemory({ storagePath: STORE }), /\[\d{2}:\d{2}\]\[telegram\]/);
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
  assert.match(readProjectLocalMemory({ storagePath: STORE }), /deploy was green/);
});

// --------------------------------------------------------------------------
// the curated half: a person writes it, and it is a different file
// --------------------------------------------------------------------------

test("the curated store round-trips a hand-written body", () => {
  writeProjectMemory(ROOT, "# northwind\n\nStack: Postgres, Redis.\n");
  assert.equal(projectMemoryPath(ROOT), apcMemoryFile(ROOT));
  assert.match(readProjectMemory(ROOT), /Stack: Postgres, Redis\./);
  // …and it did not disturb the local half.
  assert.equal(readProjectLocalMemory({ storagePath: STORE }), "");
});

test("the two routes serve two different files", async () => {
  const root = makeTempProject({ name: "contoso" });
  const registry = new ProjectManager({});
  const entry = registry.register(root);
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
  const json = { "content-type": "application/json" };
  try {
    const pid = entry.id;
    const projs = { list: () => [{ ...entry, name: "contoso" }], get: () => entry };
    remember.makeHandler({ projects: projs, channel: "web" })(
      { note: "Contoso is the reporting service", project: String(pid) }
    );

    // The agent's note is on the local route…
    let r = await fetch(`${baseUrl}/api/projects/${pid}/memory/local`);
    let body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.path, projectLocalMemoryPath(entry));
    assert.match(body.body, /reporting service/);

    // …and not on the committed one.
    r = await fetch(`${baseUrl}/api/projects/${pid}/memory`);
    body = await r.json();
    assert.equal(body.path, apcMemoryFile(root));
    assert.equal(body.body, "");

    // What the editor saves to the committed file stays there.
    r = await fetch(`${baseUrl}/api/projects/${pid}/memory`, {
      method: "PUT", headers: json, body: JSON.stringify({ body: "# contoso\n\nEdited by hand.\n" }),
    });
    assert.equal(r.status, 200);
    assert.match(readProjectMemory(root), /Edited by hand\./);
    assert.doesNotMatch(readProjectLocalMemory(entry), /Edited by hand\./);

    // And the local file is editable too — that is how a note gets trimmed
    // before anyone promotes it.
    r = await fetch(`${baseUrl}/api/projects/${pid}/memory/local`, {
      method: "PUT", headers: json, body: JSON.stringify({ body: "# contoso\n\nTrimmed.\n" }),
    });
    assert.equal(r.status, 200);
    assert.match(readProjectLocalMemory(entry), /Trimmed\./);
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
