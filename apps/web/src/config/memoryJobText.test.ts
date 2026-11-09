import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryJobText } from "./memoryJobText.ts";

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const job = (o: Partial<Parameters<typeof memoryJobText>[0]>) => ({
  id: "dream:run_1",
  kind: "dream",
  agent_id: "roby",
  thread_id: "th_1",
  state: "completed",
  attempts: 1,
  updated_at: "2026-11-09T00:00:00Z",
  result: null,
  error: null,
  ...o,
});

test("each memory job says whose notes it works on, not only that AutoDream ran", () => {
  assert.equal(memoryJobText(job({}), t, "Roby", undefined).name, 'mem.job.notebook {"agent":"Roby"}');
  assert.equal(
    memoryJobText(job({ id: "dream:shared:run_1" }), t, "Roby", "Northwind").name,
    'mem.job.sharedProject {"place":"Northwind"}',
  );
  assert.equal(memoryJobText(job({ id: "dream:shared:run_1" }), t, "Roby", undefined).name, "mem.job.sharedGlobal");
  assert.equal(memoryJobText(job({ kind: "capture" }), t, "Roby", undefined).name, 'mem.job.capture {"agent":"Roby"}');
});

test("a job says what it did, or why it waits, in the owner's words", () => {
  const desc = (o: Partial<Parameters<typeof memoryJobText>[0]>) => memoryJobText(job(o), t, "Roby", undefined).desc;
  assert.equal(
    desc({ result: '{"merged":2,"retired":1,"redated":0}' }),
    'mem.job.merged {"n":2} · mem.job.retired {"n":1}',
  );
  assert.equal(desc({ result: '{"merged":0}' }), "mem.job.unchanged");
  assert.equal(desc({ result: '{"merged":0,"retired":0,"refused":"would forget 9"}' }), "mem.job.tooMany");
  assert.equal(desc({ kind: "capture", result: '{"saved":1}' }), 'mem.job.saved {"n":1}');
  assert.equal(desc({ kind: "capture", result: '{"saved":0}' }), "mem.job.nothingNew");
  assert.equal(desc({ state: "pending", error: "daily call budget exhausted" }), "mem.job.waitBudget");
  assert.equal(desc({ state: "pending", error: "waiting for idle agent" }), 'mem.job.waitAgent {"agent":"Roby"}');
  assert.equal(desc({ state: "pending", error: "memory settings or source changed" }), "mem.job.pending");
});
