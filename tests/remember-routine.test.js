// A routine writing its own memory, without asking anyone.
//
// THE FAILURE THIS FIXES, from a real evening anchor: routine memory is a file,
// and the only way to write it was `write_file`, which is gated as dangerous.
// A scheduled run has no confirmation channel, so createPermissionGuard threw
// "Action requires user confirmation", the model treated it as a dead end, and
// secretary-day-close ended WITHOUT SENDING ANYTHING. The run still reported
// "ok", so the only symptom was silence — and finding the cause took the agent
// twenty-one shell commands.
//
// An agent recording what it learned is the most ordinary thing it does. It must
// not need a human standing by.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-remroutine-"));
process.env.HOME = TMP_HOME;

const rememberRoutine = (await import("#core/agent/tools/handlers/remember-routine.js")).default;
const { readRoutineMemory, routineMemoryPath } = await import("#core/stores/routine-memory.js");
const { TOOL_SCHEMAS, BASE_TOOL_NAMES } = await import("#core/agent/tools/registry.js");

let STORE, PROJECT_PATH, projects;

beforeEach(() => {
  STORE = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  PROJECT_PATH = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const registry = [{ id: 1, name: "alpha", path: PROJECT_PATH, storagePath: STORE }];
  projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
});

const inRoutine = (over = {}) =>
  rememberRoutine.makeHandler({
    projects,
    channel: "routine",
    channelMeta: { routineId: "r_abc", routineName: "day-close", projectPath: PROJECT_PATH, ...over },
  });

// --------------------------------------------------------------------------
// it writes, and it needs nobody
// --------------------------------------------------------------------------

test("a note lands in this routine's own memory", async () => {
  const r = await inRoutine()({ note: "Manu reads the morning message on his phone, before the laptop" });
  assert.equal(r.saved, true);
  assert.equal(r.routine, "day-close");
  assert.match(readRoutineMemory(STORE, "r_abc"), /reads the morning message/);
});

test("the handler never asks for permission", async () => {
  // Passing no requirePermission at all: if the tool consulted a guard it would
  // throw here. That is the entire point of this tool existing.
  const handler = rememberRoutine.makeHandler({
    projects,
    channel: "routine",
    channelMeta: { routineId: "r_abc", routineName: "day-close", projectPath: PROJECT_PATH },
  });
  const r = await handler({ note: "a durable thing worth keeping across runs" });
  assert.equal(r.saved, true);
});

test("two notes accumulate rather than replacing each other", async () => {
  await inRoutine()({ note: "the first durable thing learned today" });
  await inRoutine()({ note: "the second durable thing learned today" });
  const body = readRoutineMemory(STORE, "r_abc");
  assert.match(body, /first durable thing/);
  assert.match(body, /second durable thing/);
});

test("each routine writes to its own file, not a shared one", async () => {
  // The routine.id bug (C1) put every routine's memory in `routines/_unknown/`.
  // This tool must not reintroduce that by ignoring the id.
  await inRoutine()({ note: "belongs to day-close and nowhere else" });
  await inRoutine({ routineId: "r_xyz", routineName: "watch" })({ note: "belongs to watch" });
  assert.match(readRoutineMemory(STORE, "r_abc"), /day-close and nowhere else/);
  assert.doesNotMatch(readRoutineMemory(STORE, "r_abc"), /belongs to watch/);
  assert.match(readRoutineMemory(STORE, "r_xyz"), /belongs to watch/);
});

// --------------------------------------------------------------------------
// why it is safe ungated: there is no path to abuse
// --------------------------------------------------------------------------

test("the tool takes NO path argument", () => {
  // This is the whole difference from write_file. The destination comes from the
  // running routine's context, so the tool cannot write anywhere else however
  // it is called — which is why the permission is unnecessary rather than
  // merely inconvenient.
  const props = rememberRoutine.schema.function.parameters.properties;
  assert.deepEqual(Object.keys(props), ["note"]);
  assert.deepEqual(rememberRoutine.schema.function.parameters.required, ["note"]);
});

test("the destination is derived, and stays inside the routine's own directory", async () => {
  await inRoutine()({ note: "somewhere specific and nowhere else" });
  const expected = routineMemoryPath(STORE, "r_abc");
  assert.ok(fs.existsSync(expected));
  assert.ok(expected.startsWith(STORE), "never outside the project's own storage");
});

// --------------------------------------------------------------------------
// outside a routine it declines usefully
// --------------------------------------------------------------------------

test("called outside a routine it points at `remember` instead of failing blankly", async () => {
  const handler = rememberRoutine.makeHandler({
    projects, channel: "telegram", channelMeta: { chatId: "123" },
  });
  const r = await handler({ note: "a fact about the owner" });
  assert.ok(r.error);
  assert.match(r.error, /only works inside a running routine/);
  assert.match(r.error, /`remember`/, "the model needs to be told what to use instead");
});

test("an empty note is refused", async () => {
  assert.match((await inRoutine()({ note: "   " })).error, /note required/);
  assert.match((await inRoutine()({})).error, /note required/);
});

test("unresolvable storage is an error, not a silent no-op", async () => {
  const handler = rememberRoutine.makeHandler({
    projects: { list: () => [], get: () => null },
    channel: "routine",
    channelMeta: { routineId: "r_abc", projectPath: "/nope" },
  });
  assert.match((await handler({ note: "a durable note that cannot be stored" })).error, /storage/);
});

// --------------------------------------------------------------------------
// wiring
// --------------------------------------------------------------------------

test("registered, and deliberately NOT in the base set", () => {
  assert.ok(TOOL_SCHEMAS.some((s) => s.function?.name === "remember_routine"));
  // It only works inside a routine, and the routine channel already gets the
  // FULL registry. In the base set it would cost tokens on every Telegram and
  // desktop turn for a tool that errors on those channels — and the base set
  // ships on every turn (AGENTS.md rule 12).
  assert.equal(BASE_TOOL_NAMES.has("remember_routine"), false);
});

test("the description steers the model away from write_file", () => {
  const d = rememberRoutine.schema.function.description;
  assert.match(d, /instead of write_file/);
  assert.match(d, /needs no permission/);
  assert.match(d, /`remember`/, "and says when to use the global notebook instead");
});
