import assert from "node:assert/strict";
import { test } from "node:test";
import type { Routine } from "@apx/protocol";
import { editOf } from "./routines.ts";

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
