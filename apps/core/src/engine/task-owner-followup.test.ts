import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("owner follow-ups through the task and work chats preserve the current review budget", async () => {
  let task = "";
  let action: { agent: string; to: string; status: string } | undefined;
  const env = await startCore({
    llm: scriptedLlm((_req, { system, afterTool }) => {
      if (afterTool || !action || !system.startsWith(`You are ${action.agent}`)) return say("Ready.");
      const next = action;
      action = undefined;
      return callTool("transfer", "task_update", { task, assignee: next.to, status: next.status });
    }),
  });
  try {
    const store = env.core.store;
    let parent: string | undefined;
    for (const title of ["Historical root", "Historical phase", "Historical branch"])
      parent = (await env.client.call("tasks.create", { title, parent })).id;
    const created = await env.client.call("tasks.create", {
      title: "Review after owner follow-up",
      description: "Keep the same authorized assignment and review budget.",
      parent,
    });
    task = created.id;
    action = { agent: "Vera", to: "vera", status: "doing" };
    await env.client.call("tasks.update", { task, assignee: "vera", status: "doing" });
    const work = () => {
      const assignee = store.tasks.get(task)?.assignee;
      const session = store.threads.byTask(task).find((thread) => thread.agent_ids[0] === assignee);
      assert.ok(session);
      return session;
    };
    await env.settle(work().id);
    for (let round = 1; round <= 3; round++) {
      const source = work();
      action = { agent: "Vera", to: "scout", status: "review" };
      const sent = await env.client.call("threads.send", {
        thread: round === 2 ? source.id : created.thread_id,
        text: "Please send the work for independent review.",
      });
      await env.settle(source.id);
      assert.equal(action, undefined, "the owner follow-up executed its transfer request");
      assert.equal(Boolean(store.tasks.get(task)?.proposed), round === 3, "owner words do not reset review rounds");
      const run = store.runs.get(sent.run.id);
      assert.ok(run?.input?.origin.kind === "user");
      assert.ok(run.input.origin.task_assignment, "the actual admission preserves assignment provenance");
      if (round === 3) break;
      assert.equal(store.tasks.get(task)?.assignee, "scout");
      const review = work();
      await env.settle(review.id);
      action = { agent: "Scout", to: "vera", status: "doing" };
      await env.client.call("threads.send", {
        thread: round === 1 ? created.thread_id : review.id,
        text: "Please return the independently reviewed work.",
      });
      await env.settle(review.id);
      assert.equal(action, undefined);
      assert.equal(Boolean(store.tasks.get(task)?.proposed), false);
      assert.equal(store.tasks.get(task)?.assignee, "vera");
      await env.settle(work().id);
    }
    assert.deepEqual(
      store.tasks.events(task).flatMap((event) => (event.data.review_handoff ? [event.data.review_handoff] : [])),
      [
        { author: "vera", reviewer: "scout", round: 1 },
        { author: "vera", reviewer: "scout", round: 2 },
      ],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
