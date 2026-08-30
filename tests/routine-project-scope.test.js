// An agent that belongs to ONE project must read unqualified paths against it.
//
// `resolveProject` read an omitted `project` argument as "the default project",
// which is right for the super-agent and wrong for everyone else. Magui's four
// scheduled routines live in Appsi; every run called
// `run_shell tail work/marketing/magui/brain.md` and was answered
// "No such file or directory" with cwd `~/.apx/projects/default` — her own notes,
// one directory over. The runs kept succeeding, so nothing ever said the agent
// had been working from an empty memory and filing its entry where nobody reads.
//
// The bridged tools (grep/glob) ran in the daemon's own process and had it worse:
// no project at all, so a relative path resolved against the apx checkout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-scope-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
// APX_HOME and not HOME alone: the runner overrides HOME with its own APX_HOME,
// so a test that sets only HOME shares the runner's sandbox.
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runRoutineNow } = await import("#core/routines/runner.js");
const { scopeProjects, resolveProject } = await import("#core/apc/projects-helpers.js");
const { grepFiles } = await import("#core/http-tools/grep.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const MOCK = { super_agent: { enabled: true, model: "mock:test", permission_mode: "total" } };

function writeAgent(root, slug) {
  const dir = path.join(root, ".apc", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---\nname: ${slug}\nmodel: mock:test\ndescription: Test project agent.\n---\n\n# ${slug}\nDo the work.\n`,
  );
}

function entry(id, name, root) {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", `p${id}`);
  fs.mkdirSync(storagePath, { recursive: true });
  return { id, name, path: root, storagePath, config: MOCK, logMessage: () => {} };
}

/** A default project and a second one, the way the daemon registers them. */
function twoProjects() {
  const defaultRoot = makeTempProject({ name: "default" });
  const appsiRoot = makeTempProject({ name: "appsi", agents: [{ slug: "magui", model: "mock:test" }] });
  writeAgent(appsiRoot, "magui");
  // One marker apiece, so "which project answered" is visible in a file listing.
  fs.writeFileSync(path.join(defaultRoot, "DEFAULT-PROJECT.md"), "the wrong one\n");
  fs.mkdirSync(path.join(appsiRoot, "work", "marketing", "magui"), { recursive: true });
  fs.writeFileSync(path.join(appsiRoot, "work", "marketing", "magui", "brain.md"), "backlog lleno 10/10\n");
  fs.writeFileSync(path.join(appsiRoot, "APPSI-PROJECT.md"), "the right one\n");

  const zero = entry(0, "default", defaultRoot);
  const one = entry(1, "Appsi", appsiRoot);
  const projects = {
    get: (id) => (Number(id) === 0 ? zero : Number(id) === 1 ? one : null),
    list: () => [
      { id: 0, name: "default", path: defaultRoot },
      { id: 1, name: "Appsi", path: appsiRoot },
    ],
  };
  return { projects, zero, one, defaultRoot, appsiRoot };
}

test("an exec_agent routine lists files from its OWN project, not the default one", async () => {
  const { projects, one, defaultRoot, appsiRoot } = twoProjects();
  try {
    const out = await runRoutineNow(
      { project: one, projects, plugins: { get: () => null }, registries: null, globalConfig: MOCK },
      {
        name: "magui-cron-postero",
        kind: "exec_agent",
        schedule: "every:24h",
        // list_files with no arguments is the probe: it resolves "the project"
        // exactly the way run_shell and the file tools do.
        spec: { agent: "magui", prompt: "Mirá el proyecto [mock:tool:list_files]" },
      },
    );
    assert.equal(out.status, "ok");
    const call = (out.trace || []).find((t) => t.tool === "list_files");
    assert.ok(call, `expected list_files in trace, got ${JSON.stringify(out.trace)}`);
    const names = (Array.isArray(call.result) ? call.result : []).map((f) => f.name);
    assert.ok(names.includes("APPSI-PROJECT.md"), `listed the routine's project: ${names.join(", ")}`);
    assert.ok(!names.includes("DEFAULT-PROJECT.md"), "must not fall back to the default project");
  } finally {
    cleanupTempProject(defaultRoot);
    cleanupTempProject(appsiRoot);
  }
});

test("scopeProjects decides only the UNQUALIFIED case", () => {
  const { projects, zero, one, defaultRoot, appsiRoot } = twoProjects();
  try {
    const scoped = scopeProjects(projects, 1);
    // What the bug was about: no argument means "mine".
    assert.equal(resolveProject(scoped, undefined).path, one.path);
    assert.equal(resolveProject(scoped, "").path, one.path);
    // An explicit target still addresses any project, by every spelling.
    assert.equal(resolveProject(scoped, "default").path, zero.path);
    assert.equal(resolveProject(scoped, 0).path, zero.path);
    assert.equal(resolveProject(scoped, "Appsi").path, one.path);
    // And an unscoped registry is untouched — the super-agent still gets the
    // default project when nobody says otherwise.
    assert.equal(resolveProject(projects, undefined).path, zero.path);
    // Scoping to something that is not registered is a no-op, never a throw.
    assert.equal(resolveProject(scopeProjects(projects, 99), undefined).path, zero.path);
    assert.equal(scopeProjects(null, 1), null);
  } finally {
    cleanupTempProject(defaultRoot);
    cleanupTempProject(appsiRoot);
  }
});

test("a scope is a view of the registry, not a copy of it", () => {
  const { projects, one, defaultRoot, appsiRoot } = twoProjects();
  try {
    const scoped = scopeProjects(projects, 1);
    // Every method still reaches the one registry behind it.
    assert.equal(scoped.get(0).name, "default");
    assert.deepEqual(scoped.list().map((p) => p.id), [0, 1]);
    assert.equal(scoped.current().path, one.path);
  } finally {
    cleanupTempProject(defaultRoot);
    cleanupTempProject(appsiRoot);
  }
});

test("grep resolves a relative path against the cwd it was given", async () => {
  const { defaultRoot, appsiRoot } = twoProjects();
  try {
    // The exact call that failed: a path relative to the agent's project, from a
    // process standing somewhere else entirely.
    const ok = await grepFiles({
      pattern: "backlog",
      path: "work/marketing/magui/brain.md",
      cwd: appsiRoot,
    });
    assert.equal(ok.matches.length, 1, JSON.stringify(ok));

    // Without a cwd it still resolves against the process — unchanged behaviour
    // for every caller that never had a project to offer.
    await assert.rejects(
      () => grepFiles({ pattern: "backlog", path: "work/marketing/magui/brain.md" }),
      /path does not exist/,
    );

    // An absolute path ignores the cwd, as path.resolve always did.
    const abs = await grepFiles({
      pattern: "backlog",
      path: path.join(appsiRoot, "work", "marketing", "magui", "brain.md"),
      cwd: defaultRoot,
    });
    assert.equal(abs.matches.length, 1);
  } finally {
    cleanupTempProject(defaultRoot);
    cleanupTempProject(appsiRoot);
  }
});

test("a bridged file tool travels with the caller's directory", async () => {
  const { projects, one, defaultRoot, appsiRoot } = twoProjects();
  const { buildBridgedTools } = await import("#core/agent/tools/registry-bridge.js");
  try {
    const tools = buildBridgedTools();
    const grep = tools.find((t) => t.name === "grep");
    assert.ok(grep, "grep is bridged");

    // The bridge POSTs to the daemon; here we only need to see what it would
    // send, so the request is intercepted.
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      seen.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ matches: [] }) };
    };
    try {
      const scoped = scopeProjects(projects, 1);
      const handler = grep.makeHandler({ projects: scoped, globalConfig: {} });
      await handler({ pattern: "backlog", path: "work/marketing/magui/brain.md" });
      assert.equal(seen[0].cwd, one.path, "the agent's project rides along");

      // An explicit cwd is the caller's decision and is never overridden.
      await handler({ pattern: "x", cwd: "/somewhere/else" });
      assert.equal(seen[1].cwd, "/somewhere/else");

      // An unscoped ctx sends none, exactly as before.
      const plain = grep.makeHandler({ projects, globalConfig: {} });
      await plain({ pattern: "x" });
      assert.equal(seen[2].cwd, undefined);

      // And a non-file tool is left alone.
      const search = tools.find((t) => t.name === "web_search");
      await search.makeHandler({ projects: scopeProjects(projects, 1), globalConfig: {} })({ query: "x" });
      assert.equal(seen[3].cwd, undefined, "only the file tools take a directory");
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    cleanupTempProject(defaultRoot);
    cleanupTempProject(appsiRoot);
  }
});
