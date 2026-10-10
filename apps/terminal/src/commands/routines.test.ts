import assert from "node:assert/strict";
import { test } from "node:test";
import type { Routine } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";
import { editOf, findRoutine, routines } from "./routines.ts";

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
const twinB = { ...routine, id: "rtn_b", name: "digest", agent_id: "roby", project_id: "p_north" } as Routine;
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
