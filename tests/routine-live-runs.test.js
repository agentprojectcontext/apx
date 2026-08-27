// A routine run you can watch, and a history that only counts runs.
//
// Two bugs, one screen. (1) The only evidence a run existed lived in the tab
// that pressed Play: refresh it and a routine four minutes into its work looked
// idle, because the daemon kept no record of what was in flight and a run's
// messages are written to the ledger once, at the end. (2) The executions list
// filtered the ledger on `meta.routine` + a system actor, which is also what a
// "routine updated" row looks like — so editing a routine appended a run to its
// history, drawn as a success because an edit carries no status.
//
// These pin both: the in-flight registry (start → steps → end, announced on the
// bus and readable over HTTP) and the run log's refusal to count a CRUD row.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-live-runs-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runRoutineNow } = await import("#core/routines/runner.js");
const {
  startRoutineRun,
  endRoutineRun,
  getRoutineRun,
  listRoutineRuns,
  resetRoutineRuns,
} = await import("#core/routines/active-runs.js");
const { listRoutineRunLog, isRoutineRunRow } = await import("#core/routines/run-log.js");
const { onRoutineEvent } = await import("#core/events/bus.js");
const { registerSecretValues, clearRegisteredSecretValues } = await import("#core/config/secret-values.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const { http } = await import("#interfaces/cli/http.js");
const { cmdRoutineHistory } = await import("#interfaces/cli/commands/routine.js");

const CFG = { super_agent: { enabled: true, model: "mock:test", permission_mode: "total" } };

function writeAgent(root, slug) {
  const dir = path.join(root, ".apc", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---\nname: ${slug}\nmodel: mock:test\ndescription: Test project agent.\n---\n\n# ${slug}\nDo the work.\n`,
  );
}

function makeCtx(root, rows, suffix) {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", `acme-${suffix}`);
  fs.mkdirSync(storagePath, { recursive: true });
  const project = {
    id: 1, name: "acme", path: root, storagePath, config: CFG,
    logMessage: (row) => rows.push({ ts: new Date().toISOString(), ...row }),
  };
  return {
    project,
    projects: { list: () => [project], get: () => project },
    plugins: { get: () => null },
    registries: null,
    globalConfig: CFG,
  };
}

const ROUTINE = {
  name: "scout-nightly",
  kind: "exec_agent",
  schedule: "every:24h",
  spec: { agent: "scout", prompt: "Look around [mock:tool:list_projects]" },
};

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("a run is announced from its first step, and closed when it ends", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout");
  resetRoutineRuns();
  const frames = [];
  // Was the run READABLE while it was happening? Captured from inside the feed,
  // because by the time the promise resolves the run is over either way.
  const seenMidRun = [];
  const off = onRoutineEvent((ev) => {
    frames.push(ev);
    if (ev.phase !== "end") seenMidRun.push(getRoutineRun(ev.project_root, ev.routine));
  });
  const ctx = makeCtx(root, [], "live");
  try {
    const out = await runRoutineNow({ ...ctx, trigger: "manual" }, ROUTINE);
    assert.equal(out.status, "ok");

    assert.equal(frames[0]?.phase, "start", "the run announces itself before doing anything");
    assert.equal(frames[0].routine, "scout-nightly");
    assert.equal(frames[0].run.trigger, "manual");
    assert.equal(frames[0].run.agent_slug, "scout");

    assert.ok(
      seenMidRun.every(Boolean),
      "every frame before the end must have a readable run behind it",
    );

    const last = frames.at(-1);
    assert.equal(last.phase, "end", "the run says when it is over");
    assert.equal(last.run.status, "ok");
    assert.equal(
      last.run.conversation_id, out.conversation_id,
      "the closing frame names the chat the run filed into",
    );

    // The steps the panel draws while it waits: the tool the agent called, and
    // what it said. Neither exists in the ledger until the run is over.
    const steps = frames.flatMap((f) => f.run.steps);
    assert.ok(
      steps.some((s) => s.kind === "tool" && s.tool === "list_projects"),
      `the tool call must reach the live record, got ${JSON.stringify(steps.map((s) => s.tool || s.kind))}`,
    );
    assert.ok(
      steps.some((s) => s.kind === "tool" && s.status === "done"),
      "a finished tool call is marked done, not left spinning",
    );
    // The answer rides on the closing frame, not on a step: the agent loop only
    // announces text on iterations that also called a tool, so the final turn —
    // the one that actually says something — never reaches a live watcher
    // otherwise. A run that ends is a run whose answer you can read.
    assert.ok(last.run.text.includes("mock:test"), `the run's answer reaches the record, got ${JSON.stringify(last.run.text)}`);

    // The phases the pipeline walks, so "it is running" can say WHAT it is doing.
    assert.ok(new Set(frames.map((f) => f.run.phase)).has("agent"));

    assert.equal(
      getRoutineRun(ctx.project.storagePath, ROUTINE.name), null,
      "a finished run is not still in flight",
    );
  } finally {
    off();
    cleanupTempProject(root);
  }
});

test("a run that throws still closes, with the failure on it", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  resetRoutineRuns();
  const frames = [];
  const off = onRoutineEvent((ev) => frames.push(ev));
  const ctx = makeCtx(root, [], "boom");
  try {
    // A spec the handler refuses outright. A run stuck "in flight" forever
    // would be worse than one that failed.
    const out = await runRoutineNow(ctx, { ...ROUTINE, spec: { prompt: "no agent named" } });
    assert.equal(out.status, "error");
    const last = frames.at(-1);
    assert.equal(last.phase, "end");
    assert.equal(last.run.status, "error");
    assert.ok(last.run.error, "the closing frame carries why");
    assert.deepEqual(listRoutineRuns(ctx.project.storagePath), []);
  } finally {
    off();
    cleanupTempProject(root);
  }
});

test("the routines list and the run route expose what is in flight", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  resetRoutineRuns();
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  const storagePath = projects.get(id).storagePath;
  const app = buildApi({
    projects, registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
  const { server, baseUrl } = await listen(app);
  try {
    await fetch(`${baseUrl}/api/projects/${id}/routines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ROUTINE),
    });

    const idle = await (await fetch(`${baseUrl}/api/projects/${id}/routines`)).json();
    assert.equal(idle[0].running, undefined, "an idle routine is not marked running");
    const noRun = await (await fetch(`${baseUrl}/api/projects/${id}/routines/${ROUTINE.name}/run`)).json();
    assert.equal(noRun.run, null, "nothing running is an answer, not a 404");

    // A run opened by someone else entirely — the scheduler, the CLI, another
    // tab. This is the case the panel could never see.
    const run = startRoutineRun({ projectRoot: storagePath, routine: ROUTINE, trigger: "schedule" });
    const busy = await (await fetch(`${baseUrl}/api/projects/${id}/routines`)).json();
    assert.equal(busy[0].running, true);
    assert.equal(busy[0].run_started_at, run.started_at);

    const live = await (await fetch(`${baseUrl}/api/projects/${id}/routines/${ROUTINE.name}/run`)).json();
    assert.equal(live.run.trigger, "schedule");
    assert.equal(live.run.routine, ROUTINE.name);
    assert.equal(live.run.phase, "pre");

    endRoutineRun(run.id, { status: "ok" });
    const after = await (await fetch(`${baseUrl}/api/projects/${id}/routines`)).json();
    assert.equal(after[0].running, undefined);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("editing a routine does not add a run to its history", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  const storagePath = projects.get(id).storagePath;
  const app = buildApi({
    projects, registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
  const { server, baseUrl } = await listen(app);
  try {
    // Create, then edit: two ledger rows carrying meta.routine, from the same
    // actor as a run summary. Both used to show up as successful executions.
    for (const schedule of ["every:24h", "every:12h"]) {
      await fetch(`${baseUrl}/api/projects/${id}/routines`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...ROUTINE, schedule }),
      });
    }
    const empty = await (await fetch(`${baseUrl}/api/projects/${id}/routines/${ROUTINE.name}/runs`)).json();
    assert.deepEqual(empty, [], "a routine nobody has run has no executions");

    // What a real run leaves behind.
    projects.get(id).logMessage({
      channel: "routine", direction: "out", type: "system",
      actor_id: "apx:routine", author: "apx", body: "routine scout-nightly ok",
      meta: {
        routine: ROUTINE.name, status: "ok", skipped: false,
        result: { status: "ok", reply: "done", conversation_id: "2026-08-26-01", agent_slug: "scout" },
      },
    });

    const runs = await (await fetch(`${baseUrl}/api/projects/${id}/routines/${ROUTINE.name}/runs`)).json();
    assert.equal(runs.length, 1, `only the run counts, got ${JSON.stringify(runs.map((r) => r.body))}`);
    assert.equal(runs[0].status, "ok");
    // Lifted out of the result so a surface can link straight to the chat —
    // which is the whole point of recording which conversation a run filed into.
    assert.equal(runs[0].conversation_id, "2026-08-26-01");
    assert.equal(runs[0].agent_slug, "scout");

    assert.equal(
      isRoutineRunRow({ meta: { routine: ROUTINE.name, event: "routine_updated" } }, ROUTINE.name),
      false,
      "a CRUD row is never a run, whatever else it carries",
    );
    assert.equal(listRoutineRunLog(storagePath, "some-other-routine").length, 0);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("`apx routine history` lists runs, not the rows a run is made of", async () => {
  // Same defect as the panel's, on the other surface: it read the raw routine
  // channel and kept every row carrying `meta.routine` — one per tool call,
  // plus every "routine updated" — and called that the history. Both surfaces
  // now ask the daemon, which is the only place that knows what a run is.
  const asked = [];
  const realGet = http.get;
  const realLog = console.log;
  const printed = [];
  http.get = async (p) => {
    asked.push(p);
    return [{
      ts: "2026-08-26T12:02:01Z", routine: "scout-nightly", status: "ok", skipped: false,
      body: "routine scout-nightly ok", result: {}, flow: null,
      conversation_id: "2026-08-26-01", agent_slug: "scout",
    }];
  };
  console.log = (...a) => printed.push(a.join(" "));
  try {
    await cmdRoutineHistory({ _: ["scout-nightly"], flags: { project: "7" } });
  } finally {
    http.get = realGet;
    console.log = realLog;
  }
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^\/api\/projects\/7\/routines\/scout-nightly\/runs\?limit=/);
  assert.equal(printed.length, 1, "one line per run, not one per tool call");
  assert.match(printed[0], /2026-08-26T12:02:01Z ok routine scout-nightly ok/);
  // Where to go and read it — the same jump the panel's link makes.
  assert.match(printed[0], /\[chat scout\/2026-08-26-01\]/);
});

test("a step never puts a registered secret on the wire", async () => {
  // The live record is a BROADCAST: every connected panel gets each step. An
  // agent that inlines a key into a shell command would otherwise publish it to
  // all of them, which the daemon log has masked for a while and this did not.
  const { startRoutineRun, startRoutineRunTool, endRoutineRun, resetRoutineRuns: reset } =
    await import("#core/routines/active-runs.js");
  reset();
  registerSecretValues(["sk-not-a-real-key-000111"]);
  const frames = [];
  const off = onRoutineEvent((ev) => frames.push(ev));
  try {
    const run = startRoutineRun({ projectRoot: "/tmp/acme", routine: { name: "leaky", kind: "shell" } });
    startRoutineRunTool(run.id, {
      traceId: "1:1", tool: "run_shell",
      args: { command: 'curl -H "Authorization: Bearer sk-not-a-real-key-000111" https://example.com' },
    });
    endRoutineRun(run.id, { status: "ok", text: "used sk-not-a-real-key-000111 to fetch it" });
    const wire = JSON.stringify(frames);
    assert.equal(wire.includes("sk-not-a-real-key-000111"), false, "the secret must not reach a frame");
    assert.ok(wire.includes("***"), "and it is visibly masked, not silently dropped");
    // The step is still readable — masking must not turn args into rubble.
    const step = frames.flatMap((f) => f.run.steps).find((s2) => s2.kind === "tool");
    assert.equal(step.tool, "run_shell");
    assert.match(String(step.args.command), /^curl -H/);
  } finally {
    off();
    clearRegisteredSecretValues();
    reset();
  }
});
