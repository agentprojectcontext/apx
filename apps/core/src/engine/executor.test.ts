import assert from "node:assert/strict";
import { test } from "node:test";
import { openDisplay } from "./display.ts";
import { createExecutor } from "./executor.ts";
import { createInputs } from "./inputs.ts";
import { createPermissions } from "./permissions.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

for (const external of [false, true]) {
  test(`${external ? "observed" : "executed"} tool durations stay readable when the clock moves backwards`, async () => {
    const env = await startCore({ llm: scriptedLlm(() => say("Ready.")) });
    try {
      const { store } = env.core;
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      const agent = store.agents.get("superagent");
      assert.ok(agent);
      const run = store.runs.create({
        thread_id: thread.id,
        agent_id: agent.id,
        trigger: "user",
        input: { origin: { kind: "user" }, text: "Check tool timing" },
        deadline_at: "2099-01-01T00:00:00.000Z",
      });
      const display = openDisplay(
        store,
        store.messages.add({
          thread_id: thread.id,
          author: { kind: "agent", id: agent.id },
          run_id: run.id,
          parts: [],
        }),
      );
      let at = 1000;
      const unused = () => {
        throw new Error("Unexpected operation");
      };
      const executor = createExecutor({
        store,
        now: () => at--,
        inputs: createInputs({ store, home: env.home, admit: unused, hold: () => () => {} }),
        tools: [],
        agent,
        thread,
        run: () => run,
        display,
        signal: new AbortController().signal,
        untrusted: false,
        external: () => external,
        call: unused,
        delegate: unused,
        jobs: env.core.engine.jobs,
        apxPort: () => 0,
        workDir: env.home,
        permissions: createPermissions({ store, home: env.home }),
      });
      if (external) {
        executor.observe({ callId: "lookup", kind: "read", title: "Reading", status: "running" });
        executor.observe({ callId: "lookup", kind: "read", title: "Reading", status: "ok" });
      } else {
        assert.equal((await executor.execute("lookup", "missing_tool", {})).ok, false);
      }
      const messages = await env.client.call("threads.get", { thread: thread.id });
      const card = messages.messages.flatMap((m) => m.parts).find((p) => p.type === "tool");
      assert.ok(card?.type === "tool");
      assert.equal(card.ms, 0);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
