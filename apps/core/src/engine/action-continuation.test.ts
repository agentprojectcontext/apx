import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const independent of [true, false]) {
  test(`automatic continuation preserves ${independent ? "independent work" : "the duplicate guard"}`, async () => {
    let env: Awaited<ReturnType<typeof startCore>>;
    let chat = "";
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
      if (system.startsWith("You are Vera")) {
        const raw = String(req.messages.findLast((m) => m.role === "user")?.content);
        const task = /Task (task_\w+):/.exec(raw)?.[1];
        if (task)
          return afterTool
            ? say("Report delivered.")
            : callTool("finish", "task_close", {
                task,
                state: "done",
                note: "Verified report findings.",
              });
        if (said.includes("APX stopped your last turn on this task")) return say("Policy summary completed.");
        await started;
        return req.tools.length
          ? callTool(`search-${req.messages.length}`, "memory_search", {
              query: `travel policy section ${req.messages.length}`,
            })
          : say("Policy summary is incomplete.");
      }
      if (said !== "Start two analyses.") return say("Results received.");
      if (!afterTool)
        return callTool("policy", "delegate", {
          agent: "vera",
          task: "Summarize the travel policy.",
          independent,
          wait_s: 0,
        });
      if (req.messages.filter((m) => m.role === "tool").length === 1) {
        const source = env.core.store.runs.list(chat).find((r) => r.input?.text === "Start two analyses.");
        assert.ok(source);
        release();
        await waitFor(
          () => env.core.store.runs.children(source.id).some((r) => Boolean(r.input?.continues)),
          "automatic continuation admitted",
          { ms: 15000 },
        );
        return callTool("report", "task_create", {
          title: "Analyze report",
          description: "Analyze the quarterly report.",
          assignee: "vera",
        });
      }
      return say("Dispatch complete.");
    });
    env = await startCore({ llm });
    try {
      chat = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
      const sent = await env.client.call("threads.send", { thread: chat, text: "Start two analyses." });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source completion", { ms: 20000 });
      const tasks = env.core.store.tasks.list({ from_thread: chat, limit: 10 });
      assert.equal(tasks.length, independent ? 1 : 0);
      const children = env.core.store.runs.children(sent.run.id);
      const continuation = children.find((r) => r.input?.continues);
      assert.ok(continuation);
      assert.equal(Boolean(continuation.input?.task_independent), independent);
      const assignment = env.core.store.runs.steps(sent.run.id).find((s) => s.call_id === "report");
      assert.ok(assignment);
      if (independent) {
        assert.equal(assignment.state, "ok");
        assert.equal(env.core.store.threads.byTask(tasks[0]?.id ?? "").length, 1);
      } else assert.match(assignment.result ?? "", /already received a delegation/);
    } finally {
      release();
      await env.core.close();
      await env.cleanup();
    }
  });
}
