import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

test("new and existing project agents discover and read quotas; a tools list only focuses, a rule set to off still keeps it out", async () => {
  const llm = scriptedLlm((req, { afterTool }) => {
    const last = String(req.messages.at(-1)?.content);
    if (!afterTool) {
      assert.ok(req.tools.some((t) => t.function.name === "tool_search"));
      assert.ok(!req.tools.some((t) => t.function.name === "apx_settings"));
      return callTool("find", "tool_search", { query: "Claude quota usage" });
    }
    if (!last.includes("<plan_usage ")) {
      const found = String(req.messages.at(-1)?.content);
      if (!found.includes("## plan_usage")) return say("Quota tool restricted");
      return callTool("read", "tool_run", { tool: "plan_usage", args: { query: "unknown-plan" } });
    }
    return say(String(req.messages.at(-1)?.content));
  });
  await using binaries = tempDir("quota-binaries-");
  const oldPath = process.env.PATH;
  process.env.PATH = binaries.path;
  const env = await startCore({ llm });
  try {
    const { project } = await env.client.call("projects.create", { name: "Acme" });
    const agent = await env.client.call("agents.create", {
      name: "Developer",
      slug: "developer",
      project_id: project.id,
    });
    const thread = await env.client.call("threads.create", {
      kind: "loose",
      project_id: project.id,
      agent_id: agent.id,
    });
    const ask = async () => {
      await env.client.call("threads.send", { thread: thread.id, text: "Check my Claude plan quota" });
      const { messages } = await env.settle(thread.id);
      return messages.at(-1)?.parts.find((part) => part.type === "text")?.text ?? "";
    };
    for (const stage of ["new", "existing", "cleared restriction"]) {
      if (stage === "existing") await env.client.call("agents.update", { agent: agent.id, role: "Developer" });
      if (stage === "cleared restriction") await env.client.call("agents.update", { agent: agent.id, tools: [] });
      const answer = await ask();
      assert.match(answer, /<plan_usage /, `quota reader missing for ${stage}`);
      const result = JSON.parse(answer.split("\n")[1] ?? "");
      assert.equal(result.query, "unknown-plan");
      assert.equal(result.matched, false);
      assert.deepEqual(result.engines, []);
      assert.match(result.note, /does not mean zero usage/);
      if (stage === "existing") {
        // A list that leaves it out is the agent's focus: the quota reader is still found (DECISIONS.md#d-271).
        await env.client.call("agents.update", { agent: agent.id, tools: ["files", "start_session"] });
        assert.match(await ask(), /<plan_usage /, "a tools list never walls the owner's agent off a tool");
        // A rule the owner set to off is a wall, focus or not.
        await env.client.call("agents.update", { agent: agent.id, rules: { read: "off" } });
        assert.equal(await ask(), "Quota tool restricted");
        await env.client.call("agents.update", { agent: agent.id, rules: null });
      }
    }
    assert.equal(env.core.store.settings.read("engine_usage").claude, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});
