import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Attention } from "./engine/attention.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { officeScheduler } from "./office-wiring.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let clock = new Date(2026, 9, 1, 12, 0);
const sent: string[] = [];
const tray: string[] = [];
let office: ReturnType<typeof officeScheduler>;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), clock: () => new Date(2000, 0, 1) });
  office = officeScheduler({
    store: env.core.store,
    admit: () => {
      throw new Error("no routines here");
    },
    attention: { add: (n: { title: string }) => void tray.push(n.title) } as unknown as Attention,
    notifyOwner: (body) => {
      sent.push(body.text);
      return true;
    },
    log: { info() {}, warn() {}, error() {}, debug() {} } as never,
    now: () => clock,
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const task = (title: string, at: { due_at?: string; remind_at?: string }) =>
  env.client.call("tasks.create", { title, ...at });

test("due dates passing only reach the tray; never a message per task", async () => {
  for (let i = 0; i < 5; i++) await task(`Overdue ${i}`, { due_at: "2026-09-20" });
  office.tick();
  assert.equal(tray.filter((t) => t.startsWith("Overdue")).length, 5);
  assert.deepEqual(sent, []);
});

test("reminders the owner asked for reach the channel, together in one message", async () => {
  clock = new Date(2026, 9, 2, 9, 0);
  await task("Call the bank", { remind_at: "2026-10-02T08:30" });
  await task("Pay rent", { remind_at: "2026-10-02T08:45" });
  office.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /^Recordatorios:\n• Vence: (Call the bank|Pay rent)\.\n• Vence: /);
  office.tick();
  assert.equal(sent.length, 1, "each one once");
});

test("a reminder noticed hours late stays in the tray", async () => {
  clock = new Date(2026, 9, 3, 18, 0);
  await task("Water the plants", { remind_at: "2026-10-03T08:00" });
  office.tick();
  assert.ok(tray.includes("Water the plants"));
  assert.equal(sent.length, 1);
});
