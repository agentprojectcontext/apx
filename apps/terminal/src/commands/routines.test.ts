import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Routine } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";
import { editOf, findRoutine, routines } from "./routines.ts";
import { printed, recordingClient } from "./testing.ts";

const routine = {
  id: "rtn_1",
  name: "check",
  agent_id: "april",
  project_id: "p_acme",
  schedule: { kind: "every", minutes: 300 },
  prompt: "Old prompt",
  pre_command: "date",
  enabled: false,
} as Routine;

test("edit changes only what is given and keeps the rest", () => {
  const params = editOf(routine, {}, "New prompt");
  assert.deepEqual(params, {
    id: "rtn_1",
    name: "check",
    agent: "april",
    project: "p_acme",
    schedule: { kind: "every", minutes: 300 },
    prompt: "New prompt",
    enabled: false,
  });
});

test("edit replaces the schedule and commands when they are given", () => {
  const params = editOf(routine, { cron: "0 9 * * 1-5", pre: "", name: "morning" }, undefined);
  assert.deepEqual(params.schedule, { kind: "cron", cron: "0 9 * * 1-5" });
  assert.equal(params.prompt, "Old prompt");
  assert.equal(params.pre_command, "");
  assert.equal(params.name, "morning");
});

const weather = { ...routine, id: "rtn_w", name: "weather-acme", project_id: undefined } as Routine;
const twinA = { ...routine, id: "rtn_a", name: "digest", project_id: "p_acme" } as Routine;
const twinB = { ...routine, id: "rtn_b", name: "digest", agent_id: "superagent", project_id: "p_north" } as Routine;
const all = [routine, weather, twinA, twinB];

test("a routine is found by id, by name and by name in any case", () => {
  assert.equal(findRoutine(all, "rtn_w").id, "rtn_w");
  assert.equal(findRoutine(all, "weather-acme").id, "rtn_w");
  assert.equal(findRoutine(all, "Weather-ACME").id, "rtn_w");
});

test("a name two routines share asks for the id, unless --project tells them apart", () => {
  assert.throws(() => findRoutine(all, "digest"), /2 routines are named digest; give the id:\n {2}rtn_a[\s\S]*rtn_b/);
  assert.equal(findRoutine(all, "digest", "p_north").id, "rtn_b");
  // An id is unique, so --project does not hide it.
  assert.equal(findRoutine(all, "rtn_a", "p_north").id, "rtn_a");
});

test("an unknown routine says so, suggests close names and keeps to the project", () => {
  assert.throws(() => findRoutine(all, "weather"), /no routine weather \(did you mean weather-acme\?\)/);
  assert.throws(() => findRoutine(all, "weather-acme", "p_acme"), /no routine weather-acme in project p_acme/);
});

/** A client that answers routines.list from `all` and records every other call. */
function fakeClient() {
  const calls: [string, Record<string, unknown>][] = [];
  const client = {
    async call(method: string, params: Record<string, unknown>) {
      if (method === "routines.list") return { routines: all };
      calls.push([method, params]);
      if (method === "routines.set") return { ...weather, ...params, enabled: true };
      if (method === "routines.runs") return { runs: [] };
      if (method === "routines.run") return { thread_id: "thr_1" };
      return { removed: true };
    },
  } as unknown as ApxClient;
  return { client, calls };
}

async function quietly(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

test("show, edit, run, log and rm take a routine's name and send its id", async () => {
  const { client, calls } = fakeClient();
  assert.match(
    await quietly(() => routines(client, ["show", "weather-acme"], {})),
    /^rtn_w {2}weather-acme[\s\S]*Old prompt/,
  );
  await quietly(() => routines(client, ["edit", "weather-acme"], {}));
  // An edit with nothing given sends back what the routine had: a no-op.
  assert.deepEqual(calls.at(-1), ["routines.set", editOf(weather, {}, undefined)]);
  for (const sub of ["run", "log", "rm"]) await quietly(() => routines(client, [sub, "WEATHER-acme"], {}));
  assert.deepEqual(
    calls.slice(-3).map(([m, p]) => [m, p.routine]),
    [
      ["routines.run", "rtn_w"],
      ["routines.runs", "rtn_w"],
      ["routines.remove", "rtn_w"],
    ],
  );
});

test("a routine the list does not have changes nothing", async () => {
  const { client, calls } = fakeClient();
  await assert.rejects(routines(client, ["edit", "nope", "New prompt"], {}), /no routine nope/);
  await assert.rejects(routines(client, ["rm", "digest"], {}), /give the id/);
  assert.deepEqual(calls, []);
});

test("routine edits accept every call policy and reject unsupported policies", () => {
  for (const policy of ["always", "output", "succeeds", "fails", "never"])
    assert.equal(editOf(routine, { call: policy }, undefined).call_model, policy);
  for (const policy of ["sometimes", "ALWAYS", "true"])
    assert.throws(() => editOf(routine, { call: policy }, undefined), /--call is one of/);
});

test("routine step limits preserve defaults, accept the boundaries and refuse fractional or out-of-range values", () => {
  assert.equal("max_steps" in editOf(routine, {}, undefined), false);
  assert.equal(editOf(routine, { maxSteps: "default" }, undefined).max_steps, null);
  for (const limit of [5, 200]) assert.equal(editOf(routine, { maxSteps: String(limit) }, undefined).max_steps, limit);
  for (const limit of ["", "0", "4", "201", "5.5", "NaN", "Infinity"])
    assert.throws(() => editOf(routine, { maxSteps: limit }, undefined), /whole number from 5 to 200/);
});

test("adding a routine sends its schedule, command policies and model limit through the real protocol schema", async () => {
  const { client, calls } = recordingClient({ "routines.set": { id: "rtn_new" } });
  for (const [options, schedule] of [
    [{ cron: "30 8 * * 1-5" }, { kind: "cron", cron: "30 8 * * 1-5" }],
    [{ every: "60" }, { kind: "every", minutes: 60 }],
    [{ at: "2026-10-19T09:00:00-03:00" }, { kind: "once", at: "2026-10-19T12:00:00.000Z" }],
    [{}, { kind: "manual" }],
  ] as const) {
    const output = await printed(() =>
      routines(client, ["add", "morning", "Read", "updates"], {
        ...options,
        agent: "april",
        project: "p_acme",
        pre: "echo ready",
        post: "echo finished",
        call: "succeeds",
        maxSteps: "5",
      }),
    );
    assert.deepEqual(calls.at(-1), [
      "routines.set",
      {
        name: "morning",
        agent: "april",
        project: "p_acme",
        schedule,
        prompt: "Read updates",
        pre_command: "echo ready",
        post_command: "echo finished",
        call_model: "succeeds",
        max_steps: 5,
      },
    ]);
    assert.match(output, /rtn_new.*next:/);
  }
  assert.equal(calls.length, 4);
});

test("invalid routine creation and conflicting prompt inputs make no protocol calls", async () => {
  const { client, calls } = recordingClient({});
  for (const [args, options, error] of [
    [["add", "name", "prompt"], {}, /apx routines/],
    [["add", "name"], { agent: "april" }, /apx routines/],
    [["add", "name", "prompt"], { agent: "april", call: "bad" }, /--call/],
    [["add", "name", "prompt"], { agent: "april", maxSteps: "201" }, /--max-steps/],
    [["add", "name", "prompt"], { agent: "april", at: "not a date" }, /Invalid time value/],
    [["edit", "check", "prompt"], { promptFile: "missing-file" }, /not both/],
    [["unknown"], {}, /apx routines/],
  ] as const)
    await assert.rejects(routines(client, [...args], options), error);
  assert.deepEqual(calls, []);
});

test("editing a routine reads an exact UTF-8 prompt file and preserves its existing identity and schedule", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-prompt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "prompt.txt");
  const prompt = "Revisá cambios\nKeep the next line.\n";
  fs.writeFileSync(file, prompt);
  const { client, calls } = recordingClient({
    "routines.list": { routines: [routine] },
    "routines.set": { ...routine, prompt },
  });
  assert.match(await printed(() => routines(client, ["edit", "check"], { promptFile: file })), /rtn_1.*saved/);
  assert.deepEqual(calls, [
    ["routines.list", {}],
    ["routines.set", editOf(routine, {}, prompt)],
  ]);
  calls.length = 0;
  await assert.rejects(routines(client, ["edit", "check"], { promptFile: path.join(dir, "absent") }), /ENOENT/);
  assert.deepEqual(calls, []);
});

test("on and off change only enabled state, preserving commands at the protocol boundary", async () => {
  for (const enabled of [true, false]) {
    const { client, calls } = recordingClient({
      "routines.list": { routines: [routine] },
      "routines.set": { ...routine, enabled },
    });
    const output = await printed(() => routines(client, [enabled ? "on" : "off", "check"], {}));
    assert.deepEqual(calls.at(-1), [
      "routines.set",
      {
        id: routine.id,
        name: routine.name,
        agent: routine.agent_id,
        project: routine.project_id,
        schedule: routine.schedule,
        prompt: routine.prompt,
        enabled,
      },
    ]);
    assert.match(output, enabled ? /^on, next:/ : /^off$/);
  }
});

test("routine failures propagate without printing a saved or started result", async () => {
  const { client, calls } = recordingClient({
    "routines.list": { routines: [routine] },
    "routines.run": new Error("Core is unavailable"),
  });
  const output = await printed(async () => {
    await assert.rejects(routines(client, ["run", "check"], {}), /Core is unavailable/);
  });
  assert.equal(output, "");
  assert.deepEqual(calls, [
    ["routines.list", {}],
    ["routines.run", { routine: "rtn_1" }],
  ]);
});
