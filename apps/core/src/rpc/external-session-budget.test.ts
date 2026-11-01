import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { tempDir } from "../testkit/platform.ts";
import type { CallContext } from "./context.ts";

for (const scope of ["chain", "agent"] as const) {
  for (const action of ["create", "send"] as const) {
    test(`an exhausted ${scope} budget refuses external session ${action} before admission`, async () => {
      const repo = tempDir("apx-session-budget-");
      let invoked = false;
      const env = await startCore({
        llm: scriptedLlm(() => say("ok")),
        harnesses: {
          claude: {
            id: "claude",
            async run() {
              invoked = true;
              return { text: "unexpected", model: "claude/test-model" };
            },
          },
        },
      });
      try {
        const { store } = env.core;
        const project = (await env.client.call("projects.register", { path: repo.path, init: true })).project.id;
        const caller = store.threads.create({
          kind: "loose",
          title: "Caller",
          agent_ids: ["superagent"],
          project_id: project,
        });
        const parent = store.runs.create({
          thread_id: caller.id,
          agent_id: "superagent",
          trigger: "a2a_result",
          input: { origin: { kind: "user" }, text: "review" },
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
        });
        store.runs.setState(parent, "working");
        const earlier = store.threads.create({
          kind: "a2a",
          title: "Earlier",
          agent_ids: ["superagent"],
          parent_id: caller.id,
        });
        const spent = store.runs.create({
          thread_id: earlier.id,
          agent_id: "superagent",
          trigger: "a2a",
          input: { origin: { kind: "user" }, text: "previous work" },
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
        });
        store.runs.setState(spent, "completed");
        const session =
          action === "send"
            ? store.threads.create({
                kind: "code",
                title: "Review",
                agent_ids: ["superagent"],
                project_id: project,
                parent_id: caller.id,
                engine: "claude",
                cwd: repo.path,
                write: "read-only",
              })
            : undefined;
        store.settings.write("agent_limits", scope === "chain" ? { runs: 1 } : { agents: { superagent: { runs: 1 } } });
        const ctx: CallContext = {
          role: "operator",
          actor: "agent",
          transport: "internal",
          session: undefined,
          log: createLog("test", true),
          agent: { id: "superagent", thread_id: caller.id, run_id: parent.id },
        };
        const before = store.threads.list({ include_subthreads: true, limit: null }).length;
        const result = session
          ? await env.core.dispatch("threads.send", { thread: session.id, text: "review" }, ctx, "send")
          : await env.core.dispatch(
              "threads.create",
              { kind: "code", agent_id: "superagent", project_id: project, engine: "claude" },
              ctx,
              "create",
            );
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.error.message, scope === "chain" ? /wait/ : /own limit/);
        assert.equal(store.threads.list({ include_subthreads: true, limit: null }).length, before);
        if (session) assert.equal(store.runs.list(session.id).length, 0);
        assert.equal(invoked, false);
      } finally {
        await env.core.close();
        await env.cleanup();
        await repo.remove();
      }
    });
  }
}
