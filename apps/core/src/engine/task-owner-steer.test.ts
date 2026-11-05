import assert from "node:assert/strict";
import { test } from "node:test";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const mode of ["steer", "send now"] as const) {
  for (const revoke of [false, true]) {
    test(`${mode} readmission ${revoke ? "rejects revoked" : "keeps current"} assignment authority`, async () => {
      let task = "";
      let held = false;
      const release = Promise.withResolvers<void>();
      const env = await startCore({
        llm: scriptedLlm(async (_req, { system, said, afterTool }) => {
          if (afterTool || !system.startsWith("You are Vera")) return say("Ready.");
          if (!held) {
            held = true;
            await release.promise;
            return say("Initial work finished.");
          }
          if (said.includes("Pending review"))
            return callTool("review", "task_update", { task, assignee: "superagent", status: "review" });
          return say("Ready.");
        }),
      });
      try {
        task = (
          await env.client.call("tasks.create", {
            title: "Readmitted review",
            description: "Check the work before independent review.",
            assignee: "vera",
          })
        ).id;
        await waitFor(() => held, "the initial turn is held");
        const store = env.core.store;
        const work = store.threads.byTask(task).find((thread) => thread.agent_ids[0] === "vera");
        assert.ok(work);
        const original = store.runs.list(work.id)[0]?.input?.origin;
        assert.ok((original?.kind === "agent" || original?.kind === "user") && original.task_assignment);
        const sent = await env.client.call("threads.send", {
          thread: work.id,
          text: "Pending review must keep its arriving assignment.",
          mode: mode === "steer" ? "steer" : "queue",
        });
        if (mode === "send now") await env.client.call("runs.send_now", { message: sent.message.id });
        assert.deepEqual(store.messages.get(sent.message.id)?.waiting, {
          until: "step",
          task_assignment: original.task_assignment,
        });
        if (revoke) {
          await env.client.call("tasks.update", { task, assignee: null });
          await env.client.call("tasks.update", { task, assignee: "vera" });
        }
        release.resolve();
        await env.settle(work.id);
        assert.equal(Boolean(store.tasks.get(task)?.proposed), revoke, "no authorization is acquired at readmission");
        const readmitted = store.runs
          .list(work.id)
          .findLast((run) => run.input?.origin.kind === "user" && run.input.origin.message_id === sent.message.id)
          ?.input?.origin;
        assert.ok(readmitted?.kind === "user");
        assert.deepEqual(readmitted.task_assignment, original.task_assignment);
        assert.equal(store.tasks.events(task).filter((event) => event.data.review_handoff).length, revoke ? 0 : 1);
        const reviews = store.threads.byTask(task).filter((thread) => thread.agent_ids[0] === "superagent");
        assert.equal(reviews.length, revoke ? 0 : 1);
        for (const review of reviews) await env.settle(review.id);
      } finally {
        release.resolve();
        await env.core.close();
        await env.cleanup();
      }
    });
  }
}

for (const capture of ["current", "revoked", "absent"] as const) {
  test(`recovered step message preserves ${capture} task authority`, async () => {
    const home = tempDir("apx-task-steer-");
    let task = "";
    let work = "";
    let message = "";
    const first = await startCore({ home: home.path, llm: scriptedLlm(() => say("Ready.")) });
    try {
      task = (
        await first.client.call("tasks.create", {
          title: "Recover pending review",
          description: "Check recovered message provenance.",
          assignee: "vera",
        })
      ).id;
      const store = first.core.store;
      work = store.threads.byTask(task).find((thread) => thread.agent_ids[0] === "vera")?.id ?? "";
      assert.ok(work);
      await first.settle(work);
      const original = store.runs.list(work).find((run) => run.input?.origin.kind === "user")?.input?.origin;
      assert.ok(
        original?.kind === "user" && original.task_assignment,
        JSON.stringify(store.runs.list(work).map((r) => r.input?.origin)),
      );
      if (capture !== "current") {
        await first.client.call("tasks.update", { task, assignee: null });
        await first.client.call("tasks.update", { task, assignee: "vera" });
        await first.settle(work);
      }
      // Reconstruct the durable message left by a crash before its turn consumed it.
      message = store.messages.add({
        thread_id: work,
        author: { kind: "user" },
        parts: [{ type: "text", text: "Recovered review request." }],
      }).id;
      store.messages.setWaiting(message, {
        until: "step",
        ...(capture !== "absent" ? { task_assignment: original.task_assignment } : {}),
      });
    } finally {
      await first.core.close();
    }
    const second = await startCore({
      home: home.path,
      llm: scriptedLlm((_req, { system, said, afterTool }) =>
        !afterTool && system.startsWith("You are Vera") && said.includes("Recovered review")
          ? callTool("review", "task_update", { task, assignee: "superagent", status: "review" })
          : say("Ready."),
      ),
    });
    try {
      await second.settle(work);
      assert.equal(Boolean(second.core.store.tasks.get(task)?.proposed), capture !== "current");
      const origin = second.core.store.runs
        .list(work)
        .findLast((run) => run.input?.origin.kind === "user" && run.input.origin.message_id === message)?.input?.origin;
      assert.ok(origin?.kind === "user");
      assert.equal(origin.task_assignment === null, capture === "absent");
      const reviews = second.core.store.threads.byTask(task).filter((thread) => thread.agent_ids[0] === "superagent");
      assert.equal(reviews.length, capture === "current" ? 1 : 0);
      for (const review of reviews) await second.settle(review.id);
    } finally {
      await second.core.close();
      await second.cleanup();
      await home.remove();
    }
  });
}
