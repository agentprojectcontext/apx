import assert from "node:assert/strict";
import { test } from "node:test";
import { printed, recordingClient, withStdin } from "./testing.ts";
import { agents, jobs, runs, runtimeSkills, secrets, usage } from "./threads.ts";

test("run responses preserve approval decisions, free text, notes and scope; invalid input has no effects", async () => {
  const { client, calls } = recordingClient({
    "runs.respond": { id: "in_1", state: "answered", approval_scope: "session" },
  });
  assert.equal(
    await printed(() => runs(client, ["respond", "in_1", "approve", "Reviewed", "it"], 60, "session")),
    "in_1 answered (session)",
  );
  await printed(() => runs(client, ["respond", "in_2", "deny"]));
  await printed(() => runs(client, ["respond", "in_3", "Monday", "morning"]));
  assert.deepEqual(calls, [
    ["runs.respond", { input: "in_1", decision: "approve", scope: "session", text: "Reviewed it" }],
    ["runs.respond", { input: "in_2", decision: "deny" }],
    ["runs.respond", { input: "in_3", text: "Monday morning" }],
  ]);
  for (const args of [["respond", "in_1"], ["get"], ["wait"], ["unknown", "run_1"]])
    await assert.rejects(runs(client, args), /usage: apx runs/);
  await assert.rejects(runs(client, ["respond", "in_1", "approve"], 60, "invalid"));
  assert.equal(calls.length, 3);
});

test("run inspection uses explicit deadlines and pending input filters", async () => {
  const { client, calls } = recordingClient({
    "runs.get": { id: "run_1", state: "working" },
    "runs.wait": { id: "run_1", state: "completed" },
    "runs.pending": {
      inputs: [
        {
          id: "in_1",
          kind: "question",
          thread_id: "thr_1",
          prompt: "Choose",
          detail: "Two days",
          options: ["Mon", "Tue"],
        },
      ],
    },
  });
  assert.deepEqual(JSON.parse(await printed(() => runs(client, ["get", "run_1"]))), { id: "run_1", state: "working" });
  assert.deepEqual(JSON.parse(await printed(() => runs(client, ["wait", "run_1"], 12))), {
    id: "run_1",
    state: "completed",
  });
  assert.match(
    await printed(() => runs(client, ["pending", "thr_1"])),
    /Choose\n {2}Two days\n {2}options: Mon \/ Tue/,
  );
  assert.deepEqual(calls, [
    ["runs.get", { run: "run_1" }],
    ["runs.wait", { run: "run_1", timeout_s: 12 }],
    ["runs.pending", { thread: "thr_1" }],
  ]);
  const empty = recordingClient({ "runs.pending": { inputs: [] } });
  assert.equal(await printed(() => runs(empty.client, ["pending"])), "(nothing is waiting for you)");
  assert.deepEqual(empty.calls, [["runs.pending", {}]]);
});

test("agent list distinguishes the secretary, explicit models, router fallback and inherited defaults", async () => {
  const { client, calls } = recordingClient({
    "agents.list": {
      agents: [
        { id: "lead", name: "Lead", role: "Coordinator", kind: "secretary" },
        { id: "fast", name: "Fast", role: "Research", model_choice: { model: "fake/fast", router: false } },
        { id: "backup", name: "Backup", role: "Review", model_choice: { model: "fake/fast", router: true } },
        { id: "route", name: "Route", role: "Triage", model_choice: { router: true } },
      ],
    },
  });
  const out = await printed(() => agents(client));
  for (const label of ["★ Lead", "default", "fake/fast", "fake/fast → router", "router"])
    assert.ok(out.includes(label), out);
  assert.deepEqual(calls, [["agents.list", {}]]);
});

test("secrets travel on stdin only, are trimmed, never printed and can be explicitly removed", async () => {
  const { client, calls } = recordingClient({
    "secrets.set": {},
    "secrets.list": { secrets: [{ name: "acme", updated_at: "2026-01-01" }] },
  });
  assert.equal(
    await printed(() => withStdin("  test-private-value\n", () => secrets(client, ["set", "acme"]))),
    "stored acme",
  );
  assert.equal(await printed(() => secrets(client, ["rm", "acme"])), "removed acme");
  const out = await printed(() => secrets(client, []));
  assert.match(out, /acme +2026-01-01/);
  assert.doesNotMatch(out, /test-private-value/);
  assert.deepEqual(calls, [
    ["secrets.set", { name: "acme", value: "test-private-value" }],
    ["secrets.set", { name: "acme", value: null }],
    ["secrets.list", {}],
  ]);
  await assert.rejects(
    withStdin(" \n", () => secrets(client, ["set", "acme"])),
    /pipe the value/,
  );
  await assert.rejects(secrets(client, ["set"]), /usage:/);
  await assert.rejects(secrets(client, ["unknown", "acme"]), /unknown secrets/);
  assert.equal(calls.length, 3);
});

test("job list, transcript and cancellation distinguish terminal outcomes and missing jobs", async () => {
  const { client, calls } = recordingClient({
    "jobs.list": {
      running: [],
      finished: [{ id: "job_1", kind: "terminal", state: "completed", title: "Build", exit_code: 0 }],
    },
    "jobs.get": { job: { title: "Build", state: "completed", cwd: "/work/acme" }, output: "Build complete" },
    "jobs.cancel": { canceled: false },
  });
  assert.match(await printed(() => jobs(client, [])), /\(nothing running\)[\s\S]*finished:[\s\S]*Build \(exit 0\)/);
  assert.equal(await printed(() => jobs(client, ["get", "job_1"])), "Build · completed · /work/acme\nBuild complete");
  assert.equal(await printed(() => jobs(client, ["cancel", "job_1"])), "job_1 was not running");
  assert.deepEqual(calls, [
    ["jobs.list", { finished: 10 }],
    ["jobs.get", { job: "job_1" }],
    ["jobs.cancel", { job: "job_1" }],
  ]);
  for (const args of [["get"], ["unknown", "job_1"]]) await assert.rejects(jobs(client, args), /usage:|unknown jobs/);
});

test("usage selects the requested time window and reports primary and auxiliary calls separately", async (t) => {
  const now = Date.UTC(2026, 0, 31, 12);
  t.mock.method(Date, "now", () => now);
  const since = "2026-01-24T12:00:00.000Z";
  const { client, calls } = recordingClient({
    "usage.summary": {
      since,
      models: [{ model: "fake/fast", billing: "metered", runs: 2, input: 100, output: 20 }],
      aux: [{ model: "fake/fast", purpose: "title", calls: 1, input: 10, output: 2 }],
    },
  });
  const out = await printed(() => usage(client, ["7"]));
  assert.deepEqual(calls, [["usage.summary", { since }]]);
  assert.match(out, /^since 2026-01-24/);
  assert.match(out, /fake\/fast +metered +2 runs +100 in +20 out/);
  assert.match(out, /auxiliary model[\s\S]*fake\/fast · title +metered +1 calls/);
});

test("runtime skill syncing preserves dry-run intent, shows safe path summaries and explains skipped links", async () => {
  for (const dry of [true, false]) {
    const { client, calls } = recordingClient({
      "skills.runtimes": {
        steps: [
          { runtime: "acme", dir: "/work/acme", action: "create" },
          { runtime: "other", dir: "/work/linked", action: "skip-link" },
        ],
        missing: [{ runtime: "missing", dir: "/work/missing" }],
      },
    });
    const out = await printed(() => runtimeSkills(client, dry));
    assert.deepEqual(calls, [["skills.runtimes", { dry_run: dry }]]);
    assert.ok(out.includes(dry ? "would create" : "created"));
    assert.match(out, /left alone \(a link\)/);
    assert.match(out, /not installed, skipped/);
  }
});
