// `remember` inside a routine: durable facts still go global, chatter doesn't.
//
// THE FAILURE THIS FIXES: the weather routine called `remember` every run, so
// ~/.apx/memory.md — injected into every prompt on every channel — became a
// daily weather log. remember_routine already existed, but nothing stopped the
// model from reaching for the global tool. Now the handler itself applies the
// consolidation judgement (looksDurable) and diverts non-durable notes to the
// routine's own memory.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-remdivert-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const remember = (await import("#core/agent/tools/handlers/remember.js")).default;
const { readRoutineMemory } = await import("#core/stores/routine-memory.js");
const { readSelfMemory, SELF_MEMORY_PATH } = await import("#core/agent/self-memory.js");

let STORE, PROJECT_PATH, projects;

beforeEach(() => {
  fs.rmSync(SELF_MEMORY_PATH, { force: true });
  STORE = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  PROJECT_PATH = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const registry = [{ id: 1, name: "alpha", path: PROJECT_PATH, storagePath: STORE }];
  projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
});

const inRoutine = () =>
  remember.makeHandler({
    projects,
    channel: "routine",
    channelMeta: { routineId: "r_wx", routineName: "weather", projectPath: PROJECT_PATH },
  });

test("weather-style chatter from a routine lands in the routine's memory, not the notebook", async () => {
  const r = await inRoutine()({ note: "Hoy en Bariloche hace -8°C con sensación térmica de -10°C y cielo despejado." });
  assert.equal(r.saved, true);
  assert.equal(r.scope, "routine");
  assert.match(r.hint, /routine's own memory/);
  assert.match(readRoutineMemory(STORE, "r_wx"), /Bariloche/);
  assert.doesNotMatch(readSelfMemory(), /Bariloche/);
});

test("a durable owner-level fact from a routine still reaches the global notebook", async () => {
  const r = await inRoutine()({ note: "Manu decidió que los resúmenes diarios siempre llegan por Telegram." });
  assert.equal(r.saved, true);
  assert.equal(r.scope, undefined);
  assert.match(readSelfMemory(), /resúmenes diarios/);
  assert.equal(readRoutineMemory(STORE, "r_wx"), "");
});

test("outside a routine, nothing is diverted", async () => {
  const handler = remember.makeHandler({ projects, channel: "telegram", channelMeta: {} });
  const r = await handler({ note: "La rutina se ejecutó y envió un mensaje con el clima." });
  assert.equal(r.saved, true);
  assert.equal(r.scope, undefined);
  assert.match(readSelfMemory(), /\[telegram\]/);
});

test("unresolvable storage falls back to the global save — a misplaced note beats a lost one", async () => {
  const handler = remember.makeHandler({
    projects: { list: () => [], get: () => null },
    channel: "routine",
    channelMeta: { routineId: "r_wx", projectPath: "/nope" },
  });
  const r = await handler({ note: "El clima de hoy es templado y agradable en general." });
  assert.equal(r.saved, true);
  assert.match(readSelfMemory(), /templado/);
});

test("the description warns against ephemeral data", () => {
  assert.match(remember.schema.function.description, /ephemeral/i);
  assert.match(remember.schema.function.description, /remember_routine/);
});
