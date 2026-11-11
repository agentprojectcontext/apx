import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("a shell command rejected before spawning closes its job and reports the cause", async () => {
  const command = `printf a${String.fromCharCode(0)}b`;
  const llm = scriptedLlm((_req, { afterTool }) =>
    afterTool ? say("Saw the result") : callTool("shell-start", "shell", { command }),
  );
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Shell start",
    });
    await env.client.call("threads.send", { thread: chat.id, text: "Run the command" });
    await env.settle(chat.id);
    const { running, finished } = await env.client.call("jobs.list", { thread: chat.id, finished: 10 });
    assert.equal(running.filter((j) => j.kind === "terminal").length, 0);
    const job = finished.find((j) => j.kind === "terminal");
    assert.ok(job);
    assert.equal(job.state, "failed");
    assert.ok(job.ended_at);
    assert.equal(job.exit_code, undefined);
    assert.match(job.start_error ?? "", /null bytes/);
    assert.equal(env.core.store.jobs.get(job.id)?.pid, undefined);
    const result = await env.client.call("jobs.get", { job: job.id });
    assert.match(result.output, /could not start:.*null bytes/i);
    assert.match(
      String(llm.calls.at(-1)?.messages.findLast((m) => m.role === "tool")?.content),
      /could not start:.*null bytes/i,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
