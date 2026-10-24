import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { tree } from "./breaker.ts";
import { pickUpTasks, startTaskWork } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

// Roby hands work to Vera through the board; Vera closes each task she is given inside her turn on it.
let idea = "";
let reviewTask = "";
const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const tools = req.messages.filter((m) => m.role === "tool").length;
  const last = String(req.messages.at(-1)?.content);
  if (system.startsWith("You are Vera")) {
    if (said.includes("review from another session")) {
      if (!afterTool) return callTool("review", "task_comment", { task: reviewTask, text: "APPROVED: checks pass." });
      if (tools === 1) return callTool("close-review", "task_close", { task: reviewTask, state: "done" });
      return say("Review complete.");
    }
    if (said.includes("record failing review")) {
      if (!afterTool) return callTool("old-review", "task_comment", { task: reviewTask, text: "FAILED: checks fail." });
      return say("Failure recorded.");
    }
    if (said.includes("close from another session")) {
      if (!afterTool) return callTool("close-old", "task_close", { task: reviewTask, state: "done", note: "APPROVED" });
      return say("Review complete.");
    }
    if (afterTool) return say("Shipped: three PRs merged.");
    const task = /Task (task_\w+):/.exec(JSON.stringify(req.messages))?.[1] ?? "";
    return callTool("v1", "task_close", { task, state: "done", note: "all checks green" });
  }
  if (said.includes("<task_result")) return say("Vera finished it.");
  if (said.includes("prepare external review")) {
    if (!afterTool) return callTool("prepare", "task_create", { title: "External review" });
    reviewTask = /created (task_\w+)/.exec(last)?.[1] ?? "";
    return say("Review ready.");
  }
  if (said.includes("hand the goal")) {
    if (!afterTool)
      return callTool("r1", "task_create", {
        title: "Ship the goal",
        description: "Deliver the requested goal.",
        assignee: "vera",
      });
    return say(last);
  }
  if (said.includes("hand waiting goals")) {
    if (tools < 2)
      return callTool(`w${tools}`, "task_create", {
        title: `Waiting goal ${tools + 1}`,
        description: "Deliver the requested goal.",
        assignee: "vera",
      });
    return say("Both handed off.");
  }
  if (said.includes("hand paused goals")) {
    if (tools < 2)
      return callTool(`p${tools}`, "task_create", {
        title: `Paused goal ${tools + 1}`,
        description: "Deliver the requested goal.",
        assignee: "vera",
      });
    return say("Both handed off.");
  }
  if (said.includes("note an idea")) {
    if (!afterTool) return callTool("r3", "task_create", { title: "Someday idea" });
    idea = /created (task_\w+)/.exec(last)?.[1] ?? "";
    return say("Noted.");
  }
  if (said.includes("close the idea")) {
    if (!afterTool) return callTool("r4", "task_close", { task: idea, state: "done" });
    return say("Closed.");
  }
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** Waits until the thread has `n` runs, all ended, and nothing more arrives for a moment. */
async function runsOf(thread: string, n: number, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = await env.client.call("threads.get", { thread });
    if (t.runs.length >= n && t.runs.every((r) => r.ended_at)) {
      await new Promise((r) => setTimeout(r, 300));
      const again = await env.client.call("threads.get", { thread });
      if (again.runs.length === t.runs.length && again.runs.every((r) => r.ended_at)) return again;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`thread ${thread} never got ${n} runs`);
}

const allTasks = async () =>
  (await Promise.all((["open", "done"] as const).map((state) => env.client.call("tasks.list", { state })))).flatMap(
    (r) => r.tasks,
  );

test("a task an agent gave to another wakes its creator where it created it, with the closer's report", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "goal" });
  await env.client.call("threads.send", { thread: chat.id, text: "hand the goal to Vera" });
  const { runs, messages } = await runsOf(chat.id, 2);
  assert.deepEqual(
    runs.map((r) => r.trigger),
    ["a2a_result", "user"],
  );
  assert.match(texts(messages).join("\n"), /When they close it, their report comes here\./);
  assert.equal(texts(messages).at(-1), "Vera finished it.");

  const task = (await allTasks()).find((t) => t.title === "Ship the goal");
  assert.equal(task?.state, "done");
  assert.equal(task?.created_by, "roby");
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("<task_result"));
  assert.match(
    String(input?.messages.at(-1)?.content),
    new RegExp(
      `<task_result task="${task?.id}" title="Ship the goal" from="Vera" state="done" trust="team">\\nShipped: three PRs merged\\.\\n\\nClosing note: all checks green\\n</task_result>\\nA task you created and gave to Vera is closed \\(done\\)`,
    ),
  );
});

test("closing through RPC from another session preserves a fresh review without a closing note", async () => {
  const creator = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Fresh review" });
  await env.client.call("threads.send", { thread: creator.id, text: "prepare external review" });
  await runsOf(creator.id, 1);
  assert.ok(reviewTask);
  const reviewer = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "vera",
    title: "Review session",
  });
  await env.client.call("threads.send", { thread: reviewer.id, text: "review from another session" });
  await runsOf(reviewer.id, 1);
  const result = await runsOf(creator.id, 2);
  const report = result.runs.find((r) => r.trigger === "a2a_result");
  assert.ok(report);
  const input = llm.calls.findLast((c) =>
    String(c.messages.at(-1)?.content).includes(`<task_result task="${reviewTask}"`),
  );
  const text = String(input?.messages.at(-1)?.content);
  assert.match(text, /APPROVED: checks pass\./);
  assert.doesNotMatch(text, /Earlier comment|final answer pending/);
});

test("closing through RPC from another session labels a review from an earlier run", async () => {
  const creator = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Old review" });
  await env.client.call("threads.send", { thread: creator.id, text: "prepare external review" });
  await runsOf(creator.id, 1);
  const reviewer = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "vera",
    title: "Earlier review",
  });
  await env.client.call("threads.send", { thread: reviewer.id, text: "record failing review" });
  await runsOf(reviewer.id, 1);
  const closing = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "vera",
    title: "Closing session",
  });
  await env.client.call("threads.send", { thread: closing.id, text: "close from another session" });
  await runsOf(closing.id, 1);
  await runsOf(creator.id, 2);
  const input = llm.calls.findLast((c) =>
    String(c.messages.at(-1)?.content).includes(`<task_result task="${reviewTask}"`),
  );
  const text = String(input?.messages.at(-1)?.content);
  assert.match(text, /Closing note: APPROVED/);
  assert.match(text, /Earlier comment \(written before this close, not the closing verdict\):\nFAILED: checks fail\./);
  assert.match(text, /Closing turn's final answer pending\./);
});

test("nobody is woken when the owner closes a task or its creator closes it itself", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "ideas" });
  await env.client.call("threads.send", { thread: chat.id, text: "note an idea" });
  await runsOf(chat.id, 1);
  await env.client.call("threads.send", { thread: chat.id, text: "close the idea" });
  await runsOf(chat.id, 2);
  await env.client.call("tasks.close", { task: idea, state: "open" });
  await env.client.call("tasks.close", { task: idea, state: "done" });
  const { runs } = await runsOf(chat.id, 2);
  assert.deepEqual(
    runs.map((r) => r.trigger),
    ["user", "user"],
  );
});

test("a task chat counts against the chat that gave it; past the limits a task given waits and a close wakes nobody", async () => {
  const { store } = env.core;
  await env.client.call("agents.set_limits", { runs: 1, tokens: 0 });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "paused" });
    await env.client.call("threads.send", { thread: chat.id, text: "hand paused goals to Vera" });
    await runsOf(chat.id, 1);
    const tasks = await allTasks();
    const first = tasks.find((t) => t.title === "Paused goal 1");
    const second = tasks.find((t) => t.title === "Paused goal 2");
    // The first started in Vera's chat, which spends against Roby's; that one turn reached the limit.
    const [vera] = store.threads.byTask(first?.id ?? "");
    assert.equal(store.threads.context(vera?.id ?? "").asked_from, chat.id);
    assert.ok(tree(store, chat.id).includes(vera?.id ?? ""));
    assert.ok(tree(store, vera?.id ?? "").includes(chat.id));
    // The second waits, kept in Roby's chat, and the owner sees why.
    assert.equal(second?.state, "open");
    assert.deepEqual(store.threads.byTask(second?.id ?? ""), []);
    assert.deepEqual(
      store.threads.context(chat.id).held?.map((h) => [h.task, h.agent]),
      [[second?.id, "vera"]],
    );
    // Vera's close does not wake Roby either: the report waits for the owner, as a paused notice.
    await runsOf(vera?.id ?? "", 1);
    const { runs, messages } = await runsOf(chat.id, 1);
    assert.deepEqual(
      runs.map((r) => r.trigger),
      ["user"],
    );
    const notices = messages.flatMap((m) => m.parts).filter((p) => p.type === "notice");
    assert.deepEqual(
      notices.map((p) => p.type === "notice" && p.code),
      ["breaker.held", "breaker.paused"],
    );
    assert.match(JSON.stringify(notices[0]), /Vera starts \\"Paused goal 2\\" once you let them go on/);
    // Roby was told it waits, not that it started; and the hourly pickup leaves it for the owner.
    const told = llm.calls
      .flatMap((c) => c.messages)
      .filter((m) => m.role === "tool" && /Paused goal 2|created/.test(String(m.content)));
    assert.ok(told.some((m) => /It has not started: agents here reached the owner's limit/.test(String(m.content))));
    const picked: string[] = [];
    const fake = ((a: { thread_id: string }) => {
      picked.push(store.threads.get(a.thread_id)?.task_id ?? "");
      return { id: `run_fake_${picked.length}` };
    }) as unknown as Parameters<typeof pickUpTasks>[1];
    store.settings.set("task_work_since", new Date(Date.now() - 3600_000).toISOString());
    pickUpTasks(store, fake);
    assert.ok(!picked.includes(second?.id ?? ""));
    assert.deepEqual(store.threads.byTask(second?.id ?? ""), []);

    // A fresh budget: the second goal starts, and Roby goes on with the report it kept.
    assert.deepEqual(await env.client.call("threads.go_on", { thread: chat.id, mode: "reset" }), { started: 2 });
    assert.equal(store.threads.context(chat.id).held, undefined);
    const [vera2] = store.threads.byTask(second?.id ?? "");
    assert.equal(store.threads.context(vera2?.id ?? "").asked_from, chat.id);
    await runsOf(vera2?.id ?? "", 1);
    const after = await runsOf(chat.id, 2);
    assert.deepEqual(after.runs.map((r) => r.trigger).sort(), ["system", "user"]);
    assert.ok(llm.calls.some((c) => String(c.messages.at(-1)?.content).includes("The owner let agents go on")));
  } finally {
    await env.client.call("agents.set_limits", { runs: 0, tokens: 0 });
    store.settings.write("agent_limits", {});
  }
});

test("the owner writing in a paused chat starts the tasks agents gave meanwhile", async () => {
  const { store } = env.core;
  await env.client.call("agents.set_limits", { runs: 1, tokens: 0 });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "waiting" });
    await env.client.call("threads.send", { thread: chat.id, text: "hand waiting goals to Vera" });
    await runsOf(chat.id, 1);
    const second = (await allTasks()).find((t) => t.title === "Waiting goal 2");
    assert.deepEqual(store.threads.byTask(second?.id ?? ""), []);
    await env.client.call("threads.send", { thread: chat.id, text: "ok, go on" });
    assert.equal(store.threads.byTask(second?.id ?? "").length, 1);
    assert.equal(store.threads.context(chat.id).held, undefined);
    await runsOf(chat.id, 2);
  } finally {
    await env.client.call("agents.set_limits", { runs: 0, tokens: 0 });
    store.settings.write("agent_limits", {});
  }
});

test("how deep agents hand tasks on is the breaker's: no fixed depth stops a start", async () => {
  const { store } = env.core;
  const from = store.threads.create({ kind: "loose", title: "deep", agent_ids: ["roby"] });
  const task = store.tasks.create({
    title: "Deep work",
    description: "Deliver the requested goal.",
    assignee: "vera",
    status: "todo",
    thread_id: store.threads.create({ kind: "task", title: "Deep work", agent_ids: ["vera"] }).id,
    by: "roby",
  });
  const admitted: string[] = [];
  const fake = ((a: { thread_id: string }) => {
    admitted.push(a.thread_id);
    return { id: "run_deep" };
  }) as unknown as Parameters<typeof startTaskWork>[1];
  const asker = { kind: "agent" as const, id: "roby", name: "Roby", thread_id: from.id, run_id: "run_x", depth: 9 };
  assert.ok(startTaskWork(store, fake, task, "vera", asker));
  assert.equal(admitted.length, 1);
});
