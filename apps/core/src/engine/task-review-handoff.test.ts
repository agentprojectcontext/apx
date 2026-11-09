import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("a proposed task never starts its native reviewer", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Approved")) });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Review must wait",
      description: "Wait for the owner's acceptance before doing any work.",
      propose: true,
    });
    await env.client.call("tasks.update", { task: task.id, status: "review", reviewer: "scout" });
    const store = env.core.store;
    assert.equal(store.tasks.get(task.id)?.proposed, true);
    assert.deepEqual(store.threads.sessions(task.thread_id), [], "a review consultation is work too");
    await env.client.call("tasks.update", { task: task.id, proposed: false });
    const reviews = store.threads.sessions(task.thread_id);
    assert.equal(reviews.length, 1, "the owner's acceptance starts the waiting review exactly once");
    for (const review of reviews) await env.settle(review.id);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("two independent review rounds return, but a third round waits for the owner", async () => {
  let task = "";
  let turns = 0;
  const env = await startCore({
    llm: scriptedLlm((_req, { system, afterTool }) => {
      if (afterTool) return say("Handoff recorded.");
      if (system.startsWith("You are Vera")) {
        turns++;
        if (turns === 1) return callTool("progress", "task_comment", { task, text: "Implementation checked." });
        return callTool("review", "task_update", { task, assignee: "scout", status: "review" });
      }
      if (system.startsWith("You are Scout"))
        return callTool("return", "task_update", { task, assignee: "vera", status: "doing" });
      return say("ok");
    }),
  });
  try {
    const existing = await env.client.call("tasks.create", {
      title: "Bounded review",
      description: "Review two rounds.",
    });
    task = existing.id;
    await env.client.call("tasks.update", { task, reviewer: "scout" });
    await env.client.call("tasks.update", { task, assignee: "vera", status: "doing" });
    const store = env.core.store;
    await waitFor(() => store.tasks.get(task)?.proposed === true, "third review round is proposed");
    assert.equal(
      store.threads.sessions(existing.thread_id).length,
      0,
      "a full review transfer does not start another consultation",
    );
    const sessions = store.threads.byTask(task);
    for (const session of sessions) await env.settle(session.id);
    const runs = sessions.flatMap((t) => store.runs.list(t.id, 20));
    assert.equal(runs.filter((r) => r.agent_id === "scout").length, 2, "no third reviewer is started");
    assert.equal(
      runs.filter((r) => r.agent_id === "vera").length,
      4,
      "implementation continues, then receives two returns",
    );
    const continuation = runs.find((r) => r.input?.origin.kind === "task_continue");
    assert.ok(continuation);
    assert.ok(continuation.input?.origin.kind === "task_continue" && continuation.input.origin.from_run);
    assert.equal(store.tasks.get(task)?.state, "open");
    assert.deepEqual(
      store.tasks.events(task).flatMap((event) => (event.data.review_handoff ? [event.data.review_handoff] : [])),
      [
        { author: "vera", reviewer: "scout", round: 1 },
        { author: "vera", reviewer: "scout", round: 2 },
      ],
    );
    for (const run of runs.filter((r) => r.agent_id === "scout")) {
      assert.ok(run.input);
      assert.ok(run.input.text.startsWith("Independently review this task's delivery."));
      // A review ends in one report that informs, never a gate (DECISIONS.md#d-188, DECISIONS.md#d-208), also when the
      // task itself is handed to the reviewer.
      assert.match(run.input.text, /You inform, never approve or block/);
      const origin = run.input.origin;
      assert.ok(origin.kind === "agent" && origin.task_assignment?.task === task);
      assert.ok(
        store.tasks
          .events(task)
          .some((event) => event.data.assignment_id === origin.task_assignment?.id && event.data.review_handoff),
      );
    }
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a previously configured reviewer never consults itself after reassignment", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready.")) });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Independent review only",
      description: "Do not start a self-review consultation.",
    });
    await env.client.call("tasks.update", { task: task.id, reviewer: "scout" });
    await env.client.call("tasks.update", { task: task.id, assignee: "scout", status: "review" });
    assert.equal(env.core.store.threads.sessions(task.thread_id).length, 0);
    const work = env.core.store.threads.byTask(task.id);
    assert.equal(work.length, 1);
    assert.ok(work[0]);
    await env.settle(work[0].id);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an inherited review status does not authorize a review return", async () => {
  let task = "";
  const env = await startCore({
    llm: scriptedLlm((_req, { system, afterTool }) => {
      if (afterTool) return say("Recorded.");
      return system.startsWith("You are Vera")
        ? callTool("pass", "task_update", { task, assignee: "scout" })
        : callTool("return", "task_update", { task, assignee: "vera", status: "doing" });
    }),
  });
  try {
    const existing = await env.client.call("tasks.create", {
      title: "Ordinary transfer",
      description: "Do not infer a review assignment.",
    });
    task = existing.id;
    await env.client.call("tasks.update", { task, assignee: "vera", status: "review" });
    const store = env.core.store;
    await waitFor(() => store.tasks.get(task)?.proposed === true, "ordinary backflow is proposed");
    const sessions = store.threads.byTask(task);
    for (const session of sessions) await env.settle(session.id);
    assert.equal(sessions.flatMap((s) => store.runs.list(s.id)).filter((r) => r.agent_id === "vera").length, 1);
    assert.equal(
      store.tasks.events(task).some((event) => event.data.review_handoff),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("concurrent reassignment requests cannot spend the same authorization twice", async () => {
  let task = "";
  const env = await startCore({
    llm: scriptedLlm((_req, { system, afterTool }) => {
      if (afterTool || !system.startsWith("You are Vera")) return say("Recorded.");
      const first = callTool("first-review", "task_update", { task, assignee: "scout", status: "review" });
      const second = callTool("second-review", "task_update", { task, assignee: "superagent", status: "review" });
      return {
        message: {
          ...first.message,
          tool_calls: [...(first.message.tool_calls ?? []), ...(second.message.tool_calls ?? [])],
        },
      };
    }),
  });
  try {
    const existing = await env.client.call("tasks.create", {
      title: "One active transfer",
      description: "Do not duplicate review execution.",
    });
    task = existing.id;
    await env.client.call("tasks.update", { task, assignee: "vera", status: "doing" });
    const store = env.core.store;
    await waitFor(() => store.tasks.get(task)?.proposed === true, "the second transfer waits for authorization");
    const sessions = store.threads.byTask(task);
    for (const session of sessions) await env.settle(session.id);
    const runs = sessions.flatMap((session) => store.runs.list(session.id));
    assert.equal(runs.filter((run) => run.agent_id !== "vera").length, 1);
    assert.equal(store.tasks.events(task).filter((event) => event.data.review_handoff).length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("unrelated chats cannot exempt an owner-assigned task or accept an existing proposal", async () => {
  let task = "";
  const env = await startCore({
    llm: scriptedLlm((_req, { afterTool }) =>
      afterTool
        ? say("Recorded.")
        : callTool("handoff", "task_update", { task, status: "review", assignee: "scout", reviewer: "superagent" }),
    ),
  });
  try {
    const store = env.core.store;
    let parent: string | undefined;
    for (const title of ["Old root", "Old phase", "Old branch"]) {
      const created = await env.client.call("tasks.create", { title, parent });
      parent = created.id;
    }
    for (const scenario of [
      { parent_id: parent, proposed: false, assignee: undefined },
      { parent_id: parent, proposed: false },
      { parent_id: parent, proposed: true },
      { proposed: false },
      { proposed: true },
    ]) {
      const existing = store.tasks.create({
        title: "Unauthorized handoff",
        description: "Do not inherit authority from another chat.",
        ...scenario,
        assignee: "assignee" in scenario ? scenario.assignee : "vera",
        status: "doing",
        by: "owner",
        thread_id: store.threads.create({ kind: "task", title: "Work", agent_ids: [] }).id,
      });
      task = existing.id;
      const chat = await env.client.call("threads.create", { kind: "loose", title: "Unrelated", agent_id: "vera" });
      await env.client.call("threads.send", { thread: chat.id, text: "Try the handoff." });
      const result = await env.settle(chat.id);
      assert.ok(
        result.runs.flatMap((r) => store.runs.steps(r.id)).some((s) => s.tool === "task_update" && s.state === "ok"),
      );
      assert.equal(store.tasks.get(task)?.proposed, true);
      assert.deepEqual(store.threads.byTask(task), [], "no recipient task executor starts");
      assert.deepEqual(store.threads.sessions(existing.thread_id), [], "no native reviewer starts either");
    }
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("owner-assigned existing work reaches one independent reviewer and returns under historical parents", async () => {
  let task = "";
  let authorTurns = 0;
  const env = await startCore({
    llm: scriptedLlm((_req, { system, afterTool }) => {
      if (afterTool) return say("Handoff recorded.");
      if (system.startsWith("You are Vera")) {
        authorTurns++;
        return authorTurns === 1
          ? callTool("review", "task_update", { task, assignee: "scout", status: "review" })
          : callTool("finish", "task_close", { task, state: "done", note: "Independent review received." });
      }
      if (system.startsWith("You are Scout"))
        return callTool("return", "task_update", { task, assignee: "vera", status: "doing" });
      return say("ok");
    }),
  });
  try {
    let parent: string | undefined;
    for (const title of ["Historical plan", "Historical phase", "Historical branch"]) {
      const old = await env.client.call("tasks.create", { title, parent });
      parent = old.id;
    }
    const existing = await env.client.call("tasks.create", {
      title: "Implement and independently review",
      description: "Complete the existing authorized work and return its independent review.",
      parent,
    });
    task = existing.id;
    await env.client.call("tasks.update", { task, assignee: "vera", status: "doing" });
    const store = env.core.store;
    await waitFor(
      () => store.threads.byTask(task).some((t) => store.runs.list(t.id, 20).some((r) => r.ended_at)),
      "first task executor completes",
    );
    assert.notEqual(store.tasks.get(task)?.proposed, true, "historical parents do not require another approval");
    await waitFor(() => store.tasks.get(task)?.state === "done", "review returns to its author");
    const sessions = store.threads.byTask(task);
    for (const session of sessions) await env.settle(session.id);
    const reviews = sessions.flatMap((t) => store.runs.list(t.id, 20)).filter((r) => r.agent_id === "scout");
    assert.equal(reviews.length, 1, "one independent reviewer run, not merely an assignee label");
    assert.equal(reviews[0]?.state, "completed");
    assert.equal(store.tasks.get(task)?.assignee, "vera");
    assert.notEqual(store.tasks.get(task)?.proposed, true);
    assert.deepEqual(
      store.tasks
        .events(task)
        .filter((e) => typeof e.data.assignee === "string")
        .map((e) => [e.by, e.data.assignee]),
      [
        ["owner", "vera"],
        ["vera", "scout"],
        ["scout", "vera"],
      ],
      "the assignment and review return remain traceable",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const split of [false, true]) {
  test(`an agent that rewrites the authorized task ${split ? "before" : "while"} handing it on needs the owner`, async () => {
    let task = "";
    const rewrite = {
      title: "Something else entirely",
      description: "Do unrelated work instead of what was approved.",
    };
    let turns = 0;
    const env = await startCore({
      llm: scriptedLlm((_req, { system, afterTool }) => {
        if (!system.startsWith("You are Vera")) return say("ok");
        turns++;
        if (split && turns === 1) return callTool("rewrite", "task_update", { task, ...rewrite });
        if (afterTool && !(split && turns === 2)) return say("Handoff recorded.");
        return callTool("hand", "task_update", { task, assignee: "scout", ...(split ? {} : rewrite) });
      }),
    });
    try {
      let parent: string | undefined;
      for (const title of ["Historical plan", "Historical phase", "Historical branch"]) {
        parent = (await env.client.call("tasks.create", { title, parent })).id;
      }
      task = (
        await env.client.call("tasks.create", {
          title: "Approved work",
          description: "Complete exactly the work the owner approved.",
          parent,
        })
      ).id;
      await env.client.call("tasks.update", { task, assignee: "vera", status: "doing" });
      const store = env.core.store;
      await waitFor(() => store.tasks.get(task)?.assignee === "scout", "handoff recorded");
      assert.equal(store.tasks.get(task)?.proposed, true, "a rewritten scope is not covered by the owner's assignment");
      for (const session of store.threads.byTask(task)) await env.settle(session.id);
      assert.equal(
        store.threads
          .byTask(task)
          .flatMap((t) => store.runs.list(t.id, 20))
          .filter((r) => r.agent_id === "scout").length,
        0,
      );
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

for (const had of [false, true]) {
  test(`an agent ${had ? "changing the goal the owner set" : "setting the goal a task never had"} ${had ? "needs" : "keeps"} the owner's authorization`, async () => {
    let task = "";
    let turns = 0;
    const env = await startCore({
      llm: scriptedLlm((_req, { system, afterTool }) => {
        if (!system.startsWith("You are Vera")) return say("ok");
        turns++;
        if (turns === 1) return callTool("goal", "task_update", { task, goal: "The figures match the report." });
        if (afterTool && turns > 2) return say("Handoff recorded.");
        return callTool("hand", "task_update", { task, assignee: "scout", status: "review" });
      }),
    });
    try {
      let parent: string | undefined;
      for (const title of ["Historical plan", "Historical phase", "Historical branch"]) {
        parent = (await env.client.call("tasks.create", { title, parent })).id;
      }
      task = (
        await env.client.call("tasks.create", {
          title: "Approved work",
          description: "Complete exactly the work the owner approved.",
          ...(had ? { goal: "The owner's figures are checked." } : {}),
          parent,
        })
      ).id;
      await env.client.call("tasks.update", { task, assignee: "vera", status: "doing" });
      const store = env.core.store;
      await waitFor(() => store.tasks.get(task)?.assignee === "scout", "handoff recorded");
      assert.equal(Boolean(store.tasks.get(task)?.proposed), had);
      for (const session of store.threads.byTask(task)) await env.settle(session.id);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
