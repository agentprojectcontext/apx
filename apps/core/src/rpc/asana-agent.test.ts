import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";

test("Asana reads are untrusted and agent writes wait for owner approval before REST", async () => {
  let writes = 0;
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say("done");
    if (said === "read Asana") return callTool("read", "asana_read", { request: { operation: "workspaces" } });
    if (said === "write Asana")
      return callTool("write", "asana_write", {
        request: { operation: "create_task", project: "123", name: "Acme task" },
      });
    return say(req.tools.map((t) => t.function.name).join(","));
  });
  const env = await startCore({
    llm,
    asanaFetch: async (_input, init) => {
      if (init?.method === "POST") writes++;
      return Response.json({ data: { gid: "123", name: "Outside text" } });
    },
  });
  try {
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
    const offered = () => llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
    await env.client.call("threads.send", { thread, text: "tools" });
    await env.settle(thread);
    assert.ok(!offered().includes("asana_read"));
    await env.client.call("integrations.connect", { id: "asana", values: { token: "example-pat" } });
    await env.client.call("threads.send", { thread, text: "read Asana" });
    await env.settle(thread);
    assert.ok(offered().includes("asana_read"));
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /<asana [^>]*trust="untrusted"/);
    const ctx = {
      transport: "internal" as const,
      role: "operator" as const,
      actor: "agent" as const,
      session: undefined,
      log: createLog("test", true),
      agent: { id: "roby", run_id: "test", thread_id: thread },
    };
    const rejected = await env.core.dispatch(
      "asana.write",
      { request: { operation: "create_task", project: "123", name: "Bypass" } },
      ctx,
      "bypass",
    );
    assert.equal(rejected.ok, false);
    const wrongProject = await env.core.dispatch(
      "asana.read",
      { project: "other-project", request: { operation: "workspaces" } },
      ctx,
    );
    assert.equal(wrongProject.ok, false);
    await env.client.call("threads.send", { thread, text: "write Asana" });
    const pending: Array<{ id: string }> = await inputsOrEnd(env.client, thread);
    assert.equal(writes, 0);
    assert.ok(pending[0]);
    await env.client.call("runs.respond", { input: pending[0].id, decision: "approve" });
    await env.settle(thread);
    assert.equal(writes, 1);
    await env.client.call("integrations.disconnect", { id: "asana" });
    await env.client.call("threads.send", { thread, text: "tools again" });
    await env.settle(thread);
    assert.ok(!offered().includes("asana_read"));
    assert.ok(!offered().includes("asana_write"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
