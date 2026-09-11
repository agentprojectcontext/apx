// Writing work down is part of being an agent, not a grant.
//
// WHAT HAPPENED. On 2026-09-11 an external session filed a six-point audit with
// the COO. The COO answered: "Voy a procesar estos 6 huecos operativos y abrir
// una task por cada uno en el sistema." Zero tool calls. Its declared card had
// `list_tasks` and `get_task` and none of the verbs that write one, so it could
// see the board and not put anything on it — while its skills (`apx-task`,
// `apx-commitment`) had taught it the whole vocabulary. It knew exactly what to
// promise and had nothing to keep the promise with.
//
// The six tasks exist only because the session that sent the audit noticed the
// answer was empty and filed them itself a minute later, from the CLI —
// unassigned, no body. Nobody would have noticed otherwise: a confident
// paragraph reads exactly like work that happened.
//
// WHY THE FLOOR AND NOT A GRANT. `AGENT_CORE_TOOLS` is what an agent needs in
// order to BE one, unioned onto every narrowed card; grants are for reaching
// PAST your scope (the file's own comments explain why `list_projects` and
// `send_to_agent` are deliberately kept out — they cross the project and reach
// the owner). Leaving a note about something you noticed crosses nothing. It is
// bookkeeping inside your own scope, and a card narrowed to "observe and
// report" still has to be able to leave the note, or the noticing evaporates
// when the turn ends.
//
// Deciding WHO does the work is a different question and it lives in the task's
// assignee — not in whether the observer was allowed to write it down.
//
// HALF THE FAMILY IS WORSE THAN NONE, which is why this asserts all six: read
// without write is precisely the shape that produces a promise nobody keeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_CORE_TOOLS, resolveAgentAllowedTools } from "#core/agent/agent-tools.js";

const TASK_FAMILY = ["list_tasks", "get_task", "create_task", "update_task", "complete_task", "comment_task"];

test("the task family is in the floor, all of it", () => {
  for (const name of TASK_FAMILY) {
    assert.ok(AGENT_CORE_TOOLS.includes(name), `${name} must be a floor, not a grant`);
  }
});

test("an agent narrowed to reading still gets to write work down", () => {
  // The COO's shape: a deliberately read-only card. It keeps every restriction
  // it was given and gains exactly the ability to file what it found.
  const coo = { fields: { Tools: "list_files, read_file, git_log, list_tasks, get_task" } };
  const tools = resolveAgentAllowedTools(coo);
  for (const name of TASK_FAMILY) assert.ok(tools.includes(name), `narrowed card is missing ${name}`);
  assert.ok(tools.includes("read_file"), "and keeps what it declared");
});

test("the floor does not widen a card past its own scope", () => {
  // The line this change must not cross. A narrowed card still cannot reach
  // other projects or the owner — that is what the file's existing comments
  // protect, and filing a task is not an exception to it.
  const narrow = { fields: { Tools: "list_files" } };
  const tools = resolveAgentAllowedTools(narrow);
  assert.ok(!tools.includes("list_projects"), "the install's shape is not a floor");
  assert.ok(!tools.includes("send_to_agent"), "the owner's channel is not a floor");
  assert.ok(!tools.includes("send_telegram"));
  assert.ok(!tools.includes("run_shell"), "and a floor never hands out a shell");
});

test("an explicit override still means exactly what it says", () => {
  // `routine.allowed_tools: []` is a caller saying "this run touches nothing".
  // The floor must not turn that into six.
  assert.deepEqual(resolveAgentAllowedTools({ fields: {} }, { override: [] }), []);
  assert.deepEqual(
    resolveAgentAllowedTools({ fields: {} }, { override: ["read_file"] }),
    ["read_file"],
  );
});

test("an agent that declares nothing was never the problem", () => {
  // It already had everything; the gap was only ever in narrowed cards.
  const tools = resolveAgentAllowedTools({ fields: {} });
  for (const name of TASK_FAMILY) assert.ok(tools.includes(name));
});
