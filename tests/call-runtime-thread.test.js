// A launched runtime session is visible in the chat it was launched from, and
// it starts where it was told to start.
//
// Both halves are the 2026-09-20 afternoon, pinned down. Nine Claude Code
// sessions were launched from Telegram and the panel: the six from the panel
// were killed at the 300s foreground deadline (there was no `backgroundResultSink`
// outside Telegram, so `background: true` was silently ignored), and every one
// of the nine opened in the APX project's folder while its prompt described a
// repo somewhere else. From the owner's side both failures looked the same —
// an agent saying work was running, and no work.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-thread-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const { runtimeThreadCanCarry } = await import("#core/agent/runtime-thread.js");

/** Rows the ledger holds for a channel, across every day file. */
function ledgerRows(channel) {
  const dir = path.join(process.env.APX_HOME, "messages", channel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(dir, f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    );
}

function withFakeBinary(name, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-thread-bin-"));
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, body, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const oldPath = process.env.PATH || "";
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function setup() {
  const root = makeTempProject({
    name: "Test Project",
    agents: [{ slug: "roby", role: "Coordinator", model: "mock:test" }],
  });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  return { root, projects };
}

function handlersOn(projects, channel) {
  return makeToolHandlers({
    projects,
    plugins: null,
    registries: null,
    globalConfig: { super_agent: { permission_mode: "total" } },
    channel,
  });
}

// An "aider" that reports the directory it was started in, so the assertion is
// about where the process actually ran and not about what we passed.
const ECHO_CWD = "#!/bin/sh\npwd\n";

test("cwd sends the runtime to the repo, not to the APX project folder", async () => {
  const { root, projects } = setup();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "apx-fake-repo-"));
  try {
    await withFakeBinary("aider", ECHO_CWD, async () => {
      const r = await handlersOn(projects, "web").call_runtime({
        runtime: "aider",
        prompt: "mirá este repo",
        cwd: repo,
        background: false,
      });
      assert.equal(r.cwd, path.resolve(repo), "the result says where it ran");
      const printed = String(r.result || r.output || "");
      // `pwd` prints the path with symlinks resolved (/var -> /private/var on mac).
      assert.ok(printed.includes(path.basename(repo)), `ran in ${printed}, expected ${repo}`);
      assert.ok(!printed.includes(root), "it did NOT run in the project folder");
    });
  } finally {
    cleanupTempProject(root);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("a cwd that does not exist is refused before anything is spawned", async () => {
  const { root, projects } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho SHOULD_NOT_RUN\n", async () => {
      const before = ledgerRows("web").length;
      const r = await handlersOn(projects, "web").call_runtime({
        runtime: "aider",
        prompt: "x",
        cwd: path.join(os.tmpdir(), "apx-no-such-dir-ever"),
      });
      assert.match(r.error, /not a directory that exists/);
      assert.equal(ledgerRows("web").length, before, "nothing was written to the thread either");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("the session writes its own launch and result rows into the channel's thread", async () => {
  const { root, projects } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho 'listo, arreglado'\n", async () => {
      await handlersOn(projects, "desktop").call_runtime({
        runtime: "aider",
        prompt: "arreglá el bug del punto azul",
        background: false,
      });
      const rows = ledgerRows("desktop");
      const launched = rows.find((r) => r.meta?.runtime_phase === "launched");
      const done = rows.find((r) => r.meta?.runtime_phase === "done");

      assert.ok(launched, "a launch row exists");
      assert.ok(done, "a result row exists");
      // Authored by the ENGINE. This is what makes the panel draw it as its own
      // voice in the thread instead of as more of the agent's prose.
      for (const row of [launched, done]) {
        assert.equal(row.meta.actor_kind, "engine");
        assert.equal(row.meta.actor_id, "aider");
        assert.equal(row.direction, "out");
      }
      assert.match(launched.body, /arreglá el bug del punto azul/);
      assert.match(done.body, /listo, arreglado/);
      assert.equal(launched.meta.apc_session, done.meta.apc_session, "both rows name the same session");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("a session that fails says so in the thread instead of ending in silence", async () => {
  const { root, projects } = setup();
  try {
    // exit 0 with no output is the silent-success shape `runtimeLooksLikeFailure`
    // catches — the one that used to reach the user as a confident "done".
    await withFakeBinary("aider", "#!/bin/sh\nexit 0\n", async () => {
      await handlersOn(projects, "cli").call_runtime({
        runtime: "aider",
        prompt: "tarea que no se hace",
        background: false,
      });
      const failed = ledgerRows("cli").find((r) => r.meta?.runtime_phase === "failed");
      assert.ok(failed, "the failure is on the thread");
      assert.match(failed.body, /no terminó bien/);
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("a routine's own delivery path is not doubled by these rows", () => {
  // routine delivers through its own path; a2a and group are rooms addressed by
  // thread id, which the channel+day ledger has nowhere to put.
  assert.equal(runtimeThreadCanCarry("routine"), false);
  assert.equal(runtimeThreadCanCarry("a2a"), false);
  assert.equal(runtimeThreadCanCarry("group"), false);
  assert.equal(runtimeThreadCanCarry("web"), true);
  assert.equal(runtimeThreadCanCarry("telegram"), true);
  assert.equal(runtimeThreadCanCarry(null), false);
});

test("background no longer needs Telegram: a panel-launched session runs detached", async () => {
  const { root, projects } = setup();
  try {
    // Asserted against the RUNTIME's own progress, not against a clock: a
    // wall-time threshold is a test that passes alone and fails in a full
    // suite, which teaches everyone to re-run it instead of reading it.
    //
    // The fake touches `done` only after it sleeps. Foreground would hold the
    // turn until then (and a real session until the 300s deadline killed it
    // mid-job); background hands control back while the file does not exist
    // yet, which IS the fix.
    //
    // `--version` answers at once: it is the availability probe, and a fake
    // that slept through it would be timing the probe instead of the spawn.
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apx-bg-")), "done");
    const script = '#!/bin/sh\ncase "$*" in *--version*) echo "aider 0.0.0"; exit 0;; esac\n'
      + `sleep 5\ntouch ${marker}\n`;
    await withFakeBinary("aider", script, async () => {
      const r = await handlersOn(projects, "web").call_runtime({
        runtime: "aider",
        prompt: "una sesión larga, como son las de verdad",
        background: true,
      });
      assert.equal(fs.existsSync(marker), false, "the turn got control back before the runtime finished");
      assert.equal(r.status, "launched");
      assert.equal(r.background, true);
      assert.ok(ledgerRows("web").some((row) => row.meta?.runtime_phase === "launched"));
    });
  } finally {
    cleanupTempProject(root);
  }
});
