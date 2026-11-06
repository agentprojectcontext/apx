import assert from "node:assert/strict";
import { test } from "node:test";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { assignmentProposalReason } from "./task-assignment.ts";
import { ask } from "./task-work.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

function fixture(store: Store, taskThread = true) {
  const task = store.tasks.create({
    title: "Authorized work",
    description: "Implement and review.",
    assignee: "vera",
    status: "doing",
    thread_id: store.threads.create({ kind: "task", title: "Work", agent_ids: [] }).id,
    by: "owner",
  });
  const session = (id: string) =>
    store.threads.create({
      kind: "loose",
      title: "Work",
      agent_ids: [id],
      ...(taskThread ? { task_id: task.id } : {}),
    });
  const assignment = () => {
    const id = store.tasks.events(task.id).findLast((event) => typeof event.data.assignment_id === "string")
      ?.data.assignment_id;
    assert.ok(typeof id === "string");
    return { task: task.id, id };
  };
  const author = session("vera");
  let run = store.runs.create({
    thread_id: author.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user", task_assignment: assignment() }, text: "Work" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const caller = () => ({ id: run.agent_id, thread_id: run.thread_id, run_id: run.id });
  const reason = (to: string, status = "doing") => {
    const current = store.tasks.get(task.id);
    assert.ok(current);
    return assignmentProposalReason(store, current, caller(), to, status);
  };
  const transfer = (to: string, status = "doing", recordReview = true) => {
    const policy = reason(to, status);
    const previous = run;
    store.tasks.change(task.id, { assignee: to, status }, previous.agent_id, undefined, {
      thread: previous.thread_id,
      run: previous.id,
      ...(recordReview && policy?.verified && !policy.reason && policy.review ? { review: policy.review } : {}),
    });
    run = store.runs.create({
      thread_id: session(to).id,
      agent_id: to,
      trigger: "a2a",
      input: {
        origin: {
          kind: "agent",
          id: previous.agent_id,
          name: previous.agent_id,
          thread_id: previous.thread_id,
          run_id: previous.id,
          task_assignment: assignment(),
        },
        text: "Work",
      },
      deadline_at: "2099-01-01T00:00:00Z",
    });
  };
  const continueFrom = (origin: Origin, input: Partial<NonNullable<RunRecord["input"]>> = {}) => {
    run = store.runs.create({
      thread_id: run.thread_id,
      agent_id: run.agent_id,
      trigger: "system",
      input: { origin, text: "Continue", ...input },
      deadline_at: "2099-01-01T00:00:00Z",
    });
  };
  return { task, caller, reason, transfer, continueFrom, run: () => run };
}

test("verified assignment boundaries preserve budgets, review rounds and negative authorization paths", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const store = env.core.store;
  try {
    await t.test("three actual forward handoffs are allowed; the fourth waits", () => {
      const f = fixture(store);
      for (const id of ["scout", "superagent", "next-agent"]) {
        assert.deepEqual(f.reason(id), { verified: true });
        f.transfer(id);
      }
      assert.match(f.reason("another-agent")?.reason ?? "", /three active hand-offs/);
    });
    await t.test("ordinary backflow remains blocked, independent review returns twice, a third round waits", () => {
      const ordinary = fixture(store);
      ordinary.transfer("scout");
      assert.match(ordinary.reason("vera")?.reason ?? "", /back up its active chain/);
      assert.match(ordinary.reason("vera", "review")?.reason ?? "", /back up its active chain/);
      const f = fixture(store);
      for (let round = 0; round < 2; round++) {
        assert.deepEqual(f.reason("scout", "review"), {
          verified: true,
          review: { author: "vera", reviewer: "scout", round: round + 1 },
        });
        f.transfer("scout", "review");
        assert.deepEqual(f.reason("vera"), { verified: true });
        f.transfer("vera");
      }
      assert.match(f.reason("scout", "review")?.reason ?? "", /two independent review rounds/);
    });
    await t.test("a coordinator needs the task's exact authorization, not a task label on its chat", () => {
      const f = fixture(store, false);
      assert.equal(store.threads.get(f.caller().thread_id)?.task_id, undefined);
      assert.deepEqual(f.reason("scout"), { verified: true });
      const unassigned = store.tasks.create({
        title: "Unassigned",
        description: "Wait for authorization.",
        status: "doing",
        by: "owner",
        thread_id: store.threads.create({ kind: "task", title: "Unassigned work", agent_ids: [] }).id,
      });
      assert.equal(
        assignmentProposalReason(store, unassigned, f.caller(), "scout", "review"),
        undefined,
        "no exception to the existing parent-chain policy",
      );
    });
    await t.test(
      "a review label alone, swapped roles, a new reviewer and a non-direct return cannot gain review credit",
      () => {
        const label = fixture(store);
        label.transfer("scout", "review", false);
        assert.match(label.reason("vera")?.reason ?? "", /back up its active chain/);
        const f = fixture(store);
        assert.match(f.reason("vera", "review")?.reason ?? "", /back up its active chain/);
        f.transfer("scout", "review");
        assert.match(f.reason("vera", "review")?.reason ?? "", /changes the independent review pair/);
        f.transfer("another-agent");
        assert.match(f.reason("vera")?.reason ?? "", /back up its active chain/);
        const changed = fixture(store);
        changed.transfer("scout", "review");
        changed.transfer("vera");
        assert.match(changed.reason("another-agent", "review")?.reason ?? "", /changes the independent review pair/);
      },
    );
    await t.test("a new owner request tied to the current agent assignment preserves its review budget", () => {
      const f = fixture(store);
      f.transfer("scout", "review");
      const current = f.run();
      const assignment = current.input?.origin;
      assert.ok(assignment?.kind === "agent" && assignment.task_assignment);
      const owner = store.runs.create({
        thread_id: current.thread_id,
        agent_id: "scout",
        trigger: "user",
        input: {
          origin: { kind: "user", task_assignment: assignment.task_assignment },
          text: "Return the reviewed work.",
        },
        deadline_at: "2099-01-01T00:00:00Z",
      });
      const task = store.tasks.get(f.task.id);
      assert.ok(task);
      assert.deepEqual(
        assignmentProposalReason(store, task, { id: "scout", thread_id: owner.thread_id, run_id: owner.id }, "vera"),
        { verified: true },
      );
      const unrelated = store.runs.create({
        thread_id: owner.thread_id,
        agent_id: "scout",
        trigger: "user",
        input: { origin: { kind: "user" }, text: "Unrelated request." },
        deadline_at: "2099-01-01T00:00:00Z",
      });
      assert.equal(
        assignmentProposalReason(
          store,
          task,
          { id: "scout", thread_id: unrelated.thread_id, run_id: unrelated.id },
          "vera",
        )?.verified,
        false,
      );
    });
    await t.test("no-op assignment does not consume a handoff or lose its origin", () => {
      const f = fixture(store);
      f.transfer("scout", "review");
      store.tasks.change(f.task.id, { assignee: "scout" }, "scout");
      assert.deepEqual(f.reason("vera"), { verified: true });
      const task = store.tasks.get(f.task.id);
      assert.ok(task);
      const followup = ask(
        store,
        (a) =>
          store.runs.create({
            thread_id: a.thread_id,
            agent_id: a.agent_id,
            trigger: a.trigger,
            input: { origin: a.origin, text: a.text },
            deadline_at: "2099-01-01T00:00:00Z",
          }),
        task,
        "scout",
        "Return the reviewed work.",
        { kind: "owner" },
        { kind: "user" },
      );
      assert.deepEqual(
        assignmentProposalReason(
          store,
          task,
          { id: "scout", thread_id: followup.thread_id, run_id: followup.id },
          "vera",
        ),
        { verified: true },
        "a new ask after the no-op retains the actual assignment identity",
      );
    });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("assignment authority fails closed across revocations, stale runs and outside sources", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const store = env.core.store;
  try {
    await t.test("explicit proposals and owner waits are never exempted", () => {
      for (const change of [{ proposed: true }, { awaits_owner: true }]) {
        const f = fixture(store);
        store.tasks.change(f.task.id, change, "owner");
        assert.equal(f.reason("scout")?.verified, false);
      }
    });
    await t.test("a changed scope or a close/reopen invalidates the prior assignment boundary", () => {
      for (const change of [
        { description: "Different work" },
        { goal: "A different result" },
        { state: "done" as const },
      ]) {
        const f = fixture(store);
        store.tasks.change(f.task.id, change, "owner");
        if (change.state) store.tasks.change(f.task.id, { state: "open" }, "owner");
        assert.equal(f.reason("scout")?.verified, false);
      }
    });
    await t.test("owner unassignment revokes authority even if an agent assigns itself again", () => {
      const f = fixture(store);
      store.tasks.change(f.task.id, { assignee: null }, "owner");
      store.tasks.change(f.task.id, { assignee: "vera" }, "vera");
      assert.equal(f.reason("scout")?.verified, false);
    });
    await t.test("acceptance without reassignment cannot hide an owner's unassignment", () => {
      const f = fixture(store);
      store.tasks.change(f.task.id, { assignee: null, proposed: true }, "owner");
      store.tasks.change(f.task.id, { proposed: false }, "owner");
      assert.equal(f.reason("scout")?.verified, false);
      assert.ok(f.reason("scout")?.reason, "a shallow task must not fall back to historical permission");
    });
    await t.test("a new assignment invalidates the old run by its identifier, not its timestamp", () => {
      const f = fixture(store);
      const task = store.tasks.change(f.task.id, { assignee: "vera" }, "owner");
      assert.ok(task);
      const at = store.tasks.events(task.id).at(-1)?.at;
      assert.ok(at);
      const equalTimestamps = {
        ...store,
        runs: {
          ...store.runs,
          get: (id: string) => {
            const run = store.runs.get(id);
            return run ? { ...run, started_at: at } : undefined;
          },
        },
      };
      assert.equal(assignmentProposalReason(equalTimestamps, task, f.caller(), "scout")?.verified, false);
    });
    await t.test("external origins, external chats and wrong project sessions fail closed", () => {
      const external = fixture(store);
      external.continueFrom({
        kind: "agent",
        id: "external",
        name: "Outside",
        thread_id: "outside",
        run_id: "outside",
      });
      assert.equal(external.reason("scout")?.verified, false);
      external.transfer("scout");
      assert.equal(
        external.reason("superagent")?.verified,
        false,
        "an untrusted prior handoff cannot launder authority",
      );
      const client = fixture(store);
      store.threads.mergeContext(client.caller().thread_id, { client: "outside-app" });
      assert.equal(client.reason("scout")?.verified, false);
      const moved = fixture(store);
      store.tasks.change(moved.task.id, { project_id: "other-project" }, "owner");
      assert.equal(moved.reason("scout")?.verified, false);
    });
    await t.test("missing assignment provenance and unrelated/stale executor runs cannot inherit authority", () => {
      const unverified = fixture(store);
      store.tasks.change(unverified.task.id, { assignee: "scout" }, "vera");
      store.tasks.change(unverified.task.id, { assignee: "vera" }, "scout");
      assert.equal(unverified.reason("scout")?.verified, false);
      const stale = fixture(store);
      const current = stale.run();
      stale.transfer("scout", "review");
      stale.transfer("vera");
      const task = store.tasks.get(stale.task.id);
      assert.ok(task);
      assert.equal(
        assignmentProposalReason(
          store,
          task,
          { id: "vera", thread_id: current.thread_id, run_id: current.id },
          "scout",
          "review",
        )?.verified,
        false,
      );
    });
    await t.test("automatic continuation follows its recorded source; absent links fail closed", () => {
      const f = fixture(store);
      f.continueFrom({
        kind: "task_continue",
        task_id: f.task.id,
        title: "Work",
        part: 2,
        of: 4,
        from_run: f.run().id,
      });
      assert.deepEqual(f.reason("scout", "review"), {
        verified: true,
        review: { author: "vera", reviewer: "scout", round: 1 },
      });
      const missing = fixture(store);
      missing.continueFrom({ kind: "task_continue", task_id: missing.task.id, title: "Work", part: 2, of: 4 });
      assert.equal(missing.reason("scout")?.verified, false);
    });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
