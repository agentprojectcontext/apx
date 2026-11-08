import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("accepting a proposed review invokes its reviewer rather than the assignee", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Approved: checks passed")) });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Proposed review",
      description: "Check",
      assignee: "vera",
      status: "review",
      propose: true,
    });
    // Arrange persisted proposal without invoking the already-buggy reviewer-update dispatch.
    env.core.store.tasks.change(task.id, { reviewer: "scout" }, "owner");
    assert.equal(env.core.store.threads.sessions(task.thread_id).length, 0);
    await env.client.call("tasks.update", { task: task.id, proposed: false });
    const reviewSessions = () =>
      env.core.store.threads
        .sessions(task.thread_id)
        .filter((t) => env.core.store.threads.context(t.id).consult?.review);
    const reviewer = await waitFor(() => reviewSessions()[0], "the reviewer's session");
    await env.settle(reviewer.id);
    const reviewers = reviewSessions();
    assert.deepEqual(
      reviewers.map((t) => t.agent_ids[0]),
      ["scout"],
      "accepting an already-review card starts its reviewer",
    );
    assert.ok(
      !env.core.store.threads.byTask(task.id).some((thread) => thread.agent_ids[0] === "vera"),
      "the original assignee is not restarted in review",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a review that finishes after the task becomes proposed cannot restart the assignee", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const env = await startCore({
    llm: scriptedLlm(async () => {
      await gate;
      return say("REVISE: change needed");
    }),
  });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Review race",
      description: "Check",
      assignee: "vera",
      status: "review",
      propose: true,
    });
    env.core.store.tasks.change(task.id, { reviewer: "scout" }, "owner");
    await env.client.call("tasks.update", { task: task.id, proposed: false });
    const reviewSessions = () =>
      env.core.store.threads
        .sessions(task.thread_id)
        .filter((t) => env.core.store.threads.context(t.id).consult?.review);
    const reviewer = await waitFor(() => reviewSessions()[0], "the reviewer's session");
    // Simulate a concurrent policy-forced proposal, which the public update schema cannot set directly.
    env.core.store.tasks.change(task.id, { proposed: true }, "vera");
    release?.();
    await env.settle(reviewer.id);
    assert.equal(env.core.store.tasks.get(task.id)?.proposed, true);
    assert.ok(!env.core.store.threads.byTask(task.id).some((thread) => thread.agent_ids[0] === "vera"));
  } finally {
    release?.();
    await env.core.close();
    await env.cleanup();
  }
});

test("rework cannot start a closed proposal before its acceptance", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Approved")) });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Closed proposal",
      description: "Do work",
      assignee: "vera",
      propose: true,
    });
    await env.client.call("tasks.close", { task: task.id, state: "dropped" });
    const before = env.core.store.tasks.events(task.id).length;
    await assert.rejects(
      env.client.call("tasks.close", { task: task.id, state: "open", rework: true, note: "Revise this" }),
      /accepting the proposed task first/,
    );
    assert.equal(env.core.store.tasks.get(task.id)?.state, "dropped");
    assert.equal(env.core.store.tasks.events(task.id).length, before);
    assert.equal(env.core.store.threads.byTask(task.id).length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
