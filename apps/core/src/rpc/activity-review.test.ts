import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const START = "2026-05-01T12:00:00.000Z";

test("the running core exposes validated owner settings, rejects stale writes and ticks review without a routine", async () => {
  let at = new Date(START);
  const llm = scriptedLlm(() => say('{"proposals":[]}'));
  const env = await startCore({ llm, clock: () => at, aux: true });
  try {
    const { client, core } = env;
    const health = await client.call("system.health", {});
    assert.equal(health.code_sha, core.identity.code_sha);
    const initial = await client.call("activity_review.settings", {});
    assert.deepEqual(initial.settings, { enabled: true, frequency: "daily", extra_details: "" });
    const saved = await client.call("activity_review.configure", {
      extra_details: "Focus on handoffs",
      expected: initial.settings,
    });
    await assert.rejects(
      client.call("activity_review.configure", { enabled: false, expected: initial.settings }),
      /changed/,
    );
    assert.deepEqual((await client.call("activity_review.settings", {})).settings, saved.settings);
    const bad = await fetch(`${core.url}/rpc/activity_review.configure`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "invalid-review-frequency" },
      body: JSON.stringify({ frequency: "hourly" }),
    });
    assert.equal(bad.status, 400);
    const missingKey = await fetch(`${core.url}/rpc/activity_review.configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(missingKey.status, 400);
    const thread = core.store.threads.create({ kind: "loose", title: "Working notes", agent_ids: ["superagent"] });
    const message = core.store.messages.add({
      thread_id: thread.id,
      author: { kind: "user" },
      parts: [{ type: "text", text: "Please keep acceptance criteria visible during the task handoff." }],
    });
    const run = core.store.runs.create({
      thread_id: thread.id,
      agent_id: "superagent",
      trigger: "user",
      input: { text: "Working notes", origin: { kind: "user", message_id: message.id } },
      state: "queued",
      deadline_at: "2099-01-01T00:00:00.000Z",
    });
    const completed = core.store.runs.setState(run, "completed");
    assert.ok(completed.ended_at);
    // Derive both sides of the window from the fixture; wall-clock date cannot decide eligibility.
    const end = Date.parse(completed.ended_at);
    at = new Date(end + 86_400_000);
    core.store.settings.set(
      "activity_review_runtime",
      JSON.stringify({ cursor: new Date(end - 1).toISOString(), next: at.toISOString(), state: "waiting", seen: [] }),
    );
    const routines = core.store.routines.list().length;
    core.scheduler.tick();
    await waitFor(
      async () => (await client.call("activity_review.settings", {})).state === "completed",
      "native review completes",
      { ms: 5000 },
    );
    const review = llm.calls.filter((call) =>
      String(call.messages[0]?.content).startsWith("Review the owner's recent activity"),
    );
    assert.equal(review.length, 1);
    assert.deepEqual(review[0]?.tools, []);
    assert.equal(core.store.routines.list().length, routines);
    assert.equal(core.store.tasks.list({ limit: 20 }).length, 0);
    const disabled = await client.call("activity_review.configure", { enabled: false });
    assert.equal(disabled.next_at, undefined);
    assert.equal(disabled.settings.extra_details, "Focus on handoffs");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the history says what each review read and what became of each proposal, newest first, a page at a time", async () => {
  let at = new Date(START);
  let evidence = "";
  let reviews = 0;
  const words = "I keep having to repeat the acceptance criteria before this task can be verified.";
  const llm = scriptedLlm(() =>
    say(
      JSON.stringify({
        proposals: [
          {
            title: `Keep acceptance criteria visible, take ${reviews}`,
            project: null,
            goal: "Acceptance criteria are visible before verification starts",
            change: "Inspect the current handoff and propose a small change so the acceptance criteria remain visible.",
            limitations: "This is one reported incident, not a verified general defect. The sample is incomplete.",
            acceptance: ["A fixture retains acceptance criteria across one handoff"],
            evidence: [{ message: evidence, quote: words }],
          },
        ],
      }),
    ),
  );
  const env = await startCore({ llm, clock: () => at, aux: true });
  try {
    const { client, core } = env;
    assert.deepEqual(await client.call("activity_review.history", {}), { runs: [] });
    const thread = core.store.threads.create({ kind: "loose", title: "Working notes", agent_ids: ["superagent"] });
    /** One owner turn, then a review a day later that reads it. */
    const reviewOnce = async () => {
      const message = core.store.messages.add({
        thread_id: thread.id,
        author: { kind: "user" },
        parts: [{ type: "text", text: words }],
      });
      evidence = message.id;
      const run = core.store.runs.create({
        thread_id: thread.id,
        agent_id: "superagent",
        trigger: "user",
        input: { text: words, origin: { kind: "user", message_id: message.id } },
        state: "queued",
        deadline_at: "2099-01-01T00:00:00.000Z",
      });
      const end = Date.parse(core.store.runs.setState(run, "completed").ended_at ?? "");
      // Each review is due a day after its turn, and a few minutes after the last check, which runs once a minute.
      reviews++;
      at = new Date(end + 86_400_000 + reviews * 300_000);
      const runtime = JSON.parse(core.store.settings.get("activity_review_runtime") ?? "{}");
      core.store.settings.set(
        "activity_review_runtime",
        JSON.stringify({
          seen: [],
          ...runtime,
          cursor: new Date(end - 1).toISOString(),
          next: at.toISOString(),
          state: "waiting",
        }),
      );
      const before = (await client.call("activity_review.history", {})).runs.length;
      core.scheduler.tick();
      await waitFor(
        async () =>
          (await client.call("activity_review.history", {})).runs[0]?.state === "completed" &&
          (await client.call("activity_review.history", {})).runs.length === before + 1,
        "the review is in the history",
        { ms: 5000 },
      );
    };
    await reviewOnce();
    await reviewOnce();
    await reviewOnce();
    const { runs } = await client.call("activity_review.history", {});
    assert.equal(runs.length, 3);
    assert.ok(
      runs.every((r, i) => i === 0 || (runs[i - 1]?.at ?? "") > r.at),
      "newest first",
    );
    for (const r of runs) {
      assert.equal(r.chats, 1);
      assert.equal(r.messages, 1);
      assert.ok(r.since && r.since < r.at);
      assert.equal(r.proposals.length, 1);
      assert.equal(r.proposals[0]?.outcome, "pending");
    }
    const [newest, middle, oldest] = runs.map((r) => r.proposals[0]?.task_id ?? "");
    core.store.tasks.change(newest ?? "", { proposed: false }, "owner");
    core.store.tasks.change(middle ?? "", { state: "dropped" }, "owner");
    const title = runs[2]?.proposals[0]?.title;
    core.store.tasks.remove(oldest ?? "");
    const first = await client.call("activity_review.history", { limit: 2 });
    assert.deepEqual(
      first.runs.map((r) => r.proposals[0]?.outcome),
      ["accepted", "dropped"],
    );
    assert.equal(first.next, first.runs[1]?.at);
    const second = await client.call("activity_review.history", { limit: 2, before: first.next });
    assert.equal(second.next, undefined);
    assert.deepEqual(second.runs[0]?.proposals, [{ task_id: oldest, title, outcome: "deleted" }]);
    core.store.tasks.change(newest ?? "", { state: "done" }, "owner");
    assert.equal((await client.call("activity_review.history", { limit: 1 })).runs[0]?.proposals[0]?.outcome, "done");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
