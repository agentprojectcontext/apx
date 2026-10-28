import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { startHeld, startScheduled } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const mode of ["held", "scheduled"] as const) {
  test(`${mode} work from an ended turn cannot replace the live dispatch record`, async () => {
    let env: Awaited<ReturnType<typeof startCore>>;
    let chat = "";
    let oldRun = "";
    let oldTask = "";
    let delayedStarted = false;
    const llm = scriptedLlm((_req, { system, said, afterTool }) => {
      if (system.startsWith("You are Vera")) return say("Analysis completed.");
      if (said === "Schedule analysis.")
        return afterTool
          ? say("Scheduled.")
          : callTool("old", "task_create", {
              title: "Deferred analysis",
              description: "Analyze the earlier report.",
              assignee: "vera",
              start_at: "2099-01-01T10:00:00.000Z",
            });
      if (said !== "Start current analysis.") return say("Results received.");
      if (!afterTool)
        return callTool("current", "task_create", {
          title: "Current analysis",
          description: "Analyze the current report.",
          assignee: "vera",
        });
      if (!delayedStarted) {
        delayedStarted = true;
        const { store, engine } = env.core;
        const before = store.threads.context(chat).task_dispatches;
        assert.ok(before);
        if (mode === "scheduled") {
          assert.equal(startScheduled(store, engine.admit, new Date("2099-01-01T10:00:00.000Z")).length, 1);
        } else {
          store.tasks.change(oldTask, { start_at: null }, "owner");
          store.threads.mergeContext(chat, { held: [{ task: oldTask, run: oldRun, agent: "vera", depth: 1 }] });
          assert.equal(startHeld(store, engine.admit, [chat]), 1);
        }
        assert.deepEqual(store.threads.context(chat).task_dispatches, before);
        return callTool("duplicate", "delegate", {
          agent: "vera",
          task: "Analyze the current report again.",
          wait_s: 0,
        });
      }
      return say("Kept the current task executor.");
    });
    env = await startCore({ llm });
    try {
      chat = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
      oldRun = (await env.client.call("threads.send", { thread: chat, text: "Schedule analysis." })).run.id;
      await env.settle(chat);
      oldTask = env.core.store.tasks.list({ from_thread: chat, limit: 10 })[0]?.id ?? "";
      assert.ok(oldTask);
      const current = await env.client.call("threads.send", { thread: chat, text: "Start current analysis." });
      await waitFor(() => Boolean(env.core.store.runs.get(current.run.id)?.ended_at), "live turn completion");
      const guard = env.core.store.runs.steps(current.run.id).find((s) => s.call_id === "duplicate");
      assert.match(guard?.result ?? "", /already received task/);
      assert.equal(delayedStarted, true);
      assert.equal(env.core.store.threads.byTask(oldTask).length, 1);
      assert.equal(env.core.store.threads.sessions(chat).length, 0);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
