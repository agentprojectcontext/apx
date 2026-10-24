import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

type Request = {
  kind: "request" | "appointment";
  summary: string;
  when?: string;
  details?: string;
  task?: string | null;
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  const text = /<owner_instruction>\n([\s\S]*?)\n<\/owner_instruction>/.exec(said)?.[1] ?? said;
  const plan = JSON.parse(text) as { args: Request; choose?: string | null };
  if (afterTool) {
    if (String(req.messages.at(-1)?.content).startsWith("No task changed.") && plan.choose !== undefined)
      return callTool("save", "pass_request", { ...plan.args, task: plan.choose });
    return say("Passed on.");
  }
  return callTool("check", "pass_request", plan.args);
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function contact() {
  const person = await env.client.call("contacts.set", {
    name: "Acme Buyer",
    perms: { requests: true, appointments: true },
  });
  const thread = env.core.store.threads.create({
    kind: "channel",
    title: person.name,
    agent_ids: ["roby"],
    channel: { id: "test", conversation: person.id, person_id: person.id },
  });
  return {
    person,
    thread,
    tasks: () => env.core.store.tasks.list({ person: person.id, state: "open", limit: 200 }),
    async submit(args: Request, choose?: string | null, inThread = thread.id) {
      await env.client.call("threads.send", { thread: inThread, text: JSON.stringify({ args, choose }) });
      const result = await env.settle(inThread);
      assert.equal(result.runs[0]?.state, "completed");
      const steps = env.core.store.runs.steps(result.runs[0]?.id ?? "");
      return { steps, result: steps.at(-1)?.result ?? "" };
    },
  };
}

test("a call confirmation updates its original task instead of creating another one", async () => {
  const c = await contact();
  await c.submit({
    kind: "appointment",
    summary: "Confirm a time for the pricing call",
    details: "Discuss the quote.",
  });
  const first = c.tasks()[0];
  assert.ok(first);
  await env.client.call("tasks.update", {
    task: first.id,
    title: "Owner's private title",
    description: `${first.description}\nPrivate negotiation notes.`,
    awaits_owner: false,
    status: "doing",
  });
  const updated = await c.submit(
    { kind: "appointment", summary: "Accepts the proposed call time; prepare meeting link", when: "Monday 17:30" },
    first.id,
  );
  assert.equal(c.tasks().length, 1);
  const task = c.tasks()[0];
  assert.equal(task?.id, first.id);
  assert.equal(task?.thread_id, first.thread_id);
  assert.equal(task?.status, "doing");
  assert.equal(task?.awaits_owner, true);
  assert.match(task?.title ?? "", /Accepts the proposed call time/);
  assert.match(task?.description ?? "", /Private negotiation notes\.[\s\S]*Monday 17:30/);
  assert.match(updated.steps[0]?.result ?? "", /Confirm a time for the pricing call/);
  assert.doesNotMatch(updated.steps[0]?.result ?? "", /private title|Private negotiation notes/);
  assert.match(updated.result, /updated.*existing task/);
  assert.equal(
    (await env.client.call("tasks.get", { task: first.id })).events.filter((e) => e.op === "create").length,
    1,
  );
});

test("an unrelated request creates a second task only after reading existing requests", async () => {
  const c = await contact();
  await c.submit({ kind: "request", summary: "Send the quote" });
  const first = c.tasks()[0];
  const checked = await c.submit({ kind: "request", summary: "Order oat milk", task: null });
  assert.match(checked.result, /No task changed/);
  assert.equal(c.tasks().length, 1);
  const created = await c.submit({ kind: "request", summary: "Order oat milk" }, null);
  assert.equal(created.steps.length, 2);
  assert.equal(c.tasks().length, 2);
  assert.equal(env.core.store.tasks.get(first?.id ?? "")?.title, first?.title);
  assert.ok(c.tasks().some((t) => /Order oat milk/.test(t.title)));
});

test("the selected request changes, not the most recent unrelated one", async () => {
  const c = await contact();
  await c.submit({ kind: "appointment", summary: "Pricing call" });
  const pricing = c.tasks()[0];
  assert.ok(pricing);
  await c.submit({ kind: "appointment", summary: "Technical review" }, null);
  const review = c.tasks().find((t) => /Technical review/.test(t.title));
  assert.ok(review);
  await c.submit({ kind: "appointment", summary: "Pricing call moved to Tuesday", when: "Tuesday 11:00" }, pricing.id);
  assert.equal(c.tasks().length, 2);
  assert.match(env.core.store.tasks.get(pricing.id)?.description ?? "", /Tuesday 11:00/);
  assert.deepEqual(env.core.store.tasks.get(review.id), review);
});

test("updates still work at the five-request cap while unrelated creation is refused", async () => {
  const c = await contact();
  for (let i = 0; i < 5; i++) await c.submit({ kind: "request", summary: `Order item ${i}` }, null);
  const target = c.tasks()[0];
  assert.ok(target);
  assert.equal(c.tasks().length, 5);
  const updated = await c.submit({ kind: "request", summary: "Order item with express shipping" }, target.id);
  assert.match(updated.result, /updated/);
  const blocked = await c.submit({ kind: "request", summary: "A sixth unrelated request" }, null);
  assert.match(blocked.result, /5 requests waiting/);
  assert.equal(c.tasks().length, 5);
});

test("another contact, another chat, owner-created tasks and closed requests cannot be changed", async () => {
  const c = await contact();
  const other = await contact();
  await other.submit({ kind: "request", summary: "Other contact request" });
  const foreign = other.tasks()[0];
  assert.ok(foreign);
  const own = await env.client.call("tasks.create", { title: "Private owner task", person: c.person.id });
  await c.submit({ kind: "request", summary: "Original request" });
  const original = c.tasks().find((t) => t.id !== own.id);
  assert.ok(original);
  const secondChat = env.core.store.threads.create({
    kind: "channel",
    title: "Other chat",
    agent_ids: ["roby"],
    channel: { id: "other", conversation: c.person.id, person_id: c.person.id },
  });
  const otherChat = await c.submit(
    { kind: "request", summary: "Replace it", task: original.id },
    undefined,
    secondChat.id,
  );
  assert.match(otherChat.result, /not updated/);
  for (const id of [foreign.id, own.id, "task_missing"]) {
    const blocked = await c.submit({ kind: "request", summary: "Replace it", task: id });
    assert.match(blocked.result, /not updated/);
  }
  await env.client.call("tasks.close", { task: original.id, state: "done" });
  const closed = await c.submit({ kind: "request", summary: "Replace closed request", task: original.id });
  assert.match(closed.result, /not updated/);
  assert.equal(env.core.store.tasks.get(original.id)?.state, "done");
  assert.deepEqual(env.core.store.tasks.get(foreign.id), foreign);
  assert.equal(env.core.store.tasks.get(own.id)?.title, "Private owner task");
});

test("a request cannot change an appointment when its appointment permission was revoked", async () => {
  const c = await contact();
  await c.submit({ kind: "appointment", summary: "Pricing call" });
  const original = c.tasks()[0];
  assert.ok(original);
  await env.client.call("contacts.set", { id: c.person.id, name: c.person.name, perms: { appointments: false } });
  const revoked = await c.submit({ kind: "appointment", summary: "Move call", task: original.id });
  assert.match(revoked.result, /does not take appointments/);
  const wrongKind = await c.submit({ kind: "request", summary: "Change appointment as request", task: original.id });
  assert.match(wrongKind.result, /not updated/);
  assert.deepEqual(c.tasks()[0], original);
});

test("unrelated owner tasks cannot hide an older request from lookup", async () => {
  const c = await contact();
  await c.submit({ kind: "request", summary: "An older open request" });
  const original = c.tasks()[0];
  assert.ok(original);
  for (let i = 0; i < 55; i++)
    await env.client.call("tasks.create", { title: `Private owner task ${i}`, person: c.person.id });
  const checked = await c.submit({ kind: "request", summary: "Extra information for older request" });
  assert.match(checked.result, new RegExp(original.id));
  assert.doesNotMatch(checked.result, /Private owner task/);
  assert.equal(c.tasks().length, 56);
});

test("a full description keeps the owner's notes and records the update in the task conversation", async () => {
  const c = await contact();
  await c.submit({ kind: "request", summary: "Send the quote" });
  const original = c.tasks()[0];
  assert.ok(original);
  const notes = "x".repeat(10_000);
  await env.client.call("tasks.update", { task: original.id, description: notes, awaits_owner: false });
  const updated = await c.submit(
    { kind: "request", summary: "Send revised quote", details: "Include delivery. @owner" },
    original.id,
  );
  assert.match(updated.result, /updated/);
  assert.equal(c.tasks().length, 1);
  const task = c.tasks()[0];
  assert.equal(task?.description, notes);
  assert.equal(task?.awaits_owner, true);
  assert.match(task?.title ?? "", /Send revised quote/);
  const chat = await env.client.call("threads.get", { thread: original.thread_id });
  const text = chat.messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))).join("\n");
  assert.match(text, /Send revised quote[\s\S]*Include delivery/);
  assert.match(text, /trust="untrusted"/);
  assert.match(text, /&#64;owner/);
  assert.equal(chat.runs.length, 0, "contact text starts no task work");
});
