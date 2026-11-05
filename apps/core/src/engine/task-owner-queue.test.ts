import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("queued owner follow-ups retain, but cannot refresh, an accepted assignment", async (t) => {
  for (const reassign of [false, true]) {
    await t.test(
      reassign ? "reassignment invalidates the queued request" : "the queued request can request review",
      async () => {
        let task = "";
        let held = false;
        const release = Promise.withResolvers<void>();
        const env = await startCore({
          llm: scriptedLlm(async (_req, { system, said, afterTool }) => {
            if (afterTool || !system.startsWith("You are Vera")) return say("Ready.");
            if (!held) {
              held = true;
              await release.promise;
              return say("Initial work checked.");
            }
            if (said.includes("Queue review"))
              return callTool("review", "task_update", { task, assignee: "superagent", status: "review" });
            return say("Ready.");
          }),
        });
        try {
          const created = await env.client.call("tasks.create", {
            title: "Accepted work with a queued follow-up",
            description: "Keep the authorization that existed when the message arrived.",
            assignee: "vera",
            propose: true,
          });
          task = created.id;
          await env.client.call("tasks.update", { task, proposed: false });
          await waitFor(() => held, "the assigned turn is held before the follow-up");
          const store = env.core.store;
          const work = store.threads.byTask(task).find((thread) => thread.agent_ids[0] === "vera");
          assert.ok(work);
          const queued = await env.client.call("threads.send", {
            thread: work.id,
            text: "Queue review after the current turn finishes.",
            mode: "queue",
          });
          assert.deepEqual(store.messages.get(queued.message.id)?.waiting, { until: "turn", run: queued.run.id });
          const origin = store.runs.get(queued.run.id)?.input?.origin;
          assert.ok(origin?.kind === "user" && origin.task_assignment);
          const assignment = origin.task_assignment;
          if (reassign) await env.client.call("tasks.update", { task, assignee: "scout" });
          release.resolve();
          await env.settle(work.id);
          const result = store.tasks.get(task);
          assert.equal(Boolean(result?.proposed), reassign);
          assert.equal(result?.assignee, "superagent");
          const after = store.runs.get(queued.run.id)?.input?.origin;
          assert.ok(after?.kind === "user");
          assert.deepEqual(after.task_assignment, assignment, "execution never refreshes the queued token");
          assert.equal(store.tasks.events(task).filter((event) => event.data.review_handoff).length, reassign ? 0 : 1);
          const sessions = store.threads.byTask(task);
          for (const session of sessions) await env.settle(session.id);
          assert.equal(
            sessions.flatMap((session) => store.runs.list(session.id)).filter((run) => run.agent_id === "superagent")
              .length,
            reassign ? 0 : 1,
            "a stale queued run never starts its requested reviewer",
          );
        } finally {
          release.resolve();
          await env.core.close();
          await env.cleanup();
        }
      },
    );
  }
});
