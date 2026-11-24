import assert from "node:assert/strict";
import { test } from "node:test";
import { Thread } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { tempDir } from "../testkit/platform.ts";
import type { CallContext } from "./context.ts";

test("an agent's external session is returned inside its task; a free chat's session stays free", async () => {
  const folder = tempDir("apx-session-task-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const task = await env.client.call("tasks.create", { title: "Build inventory", project });
    const { store } = env.core;
    const work = store.threads.create({
      kind: "loose",
      title: "Work",
      agent_ids: ["superagent"],
      task_id: task.id,
      project_id: project,
    });
    const free = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      project_id: project,
    });
    const home = store.threads.get(task.thread_id);
    assert.ok(home);
    for (const caller of [work, home, free]) {
      const expectedTask = caller.id === free.id ? undefined : task.id;
      const ctx: CallContext = {
        role: "operator",
        actor: "agent",
        transport: "internal",
        session: undefined,
        log: createLog("test", true),
        agent: { id: "superagent", thread_id: caller.id, run_id: "run_test" },
      };
      const result = await env.core.dispatch(
        "threads.create",
        { kind: "code", engine: "claude", agent_id: "superagent", project_id: project },
        ctx,
        caller.id,
      );
      assert.ok(result.ok);
      const session = Thread.parse(result.result);
      assert.equal(session.parent_id, caller.id);
      assert.equal(session.task_id, expectedTask);
      const listed = (await env.client.call("threads.list", { engine: "claude" })).threads;
      assert.equal(listed.find((t) => t.id === session.id)?.task_id, expectedTask);
      const details = await env.client.call("tasks.get", { task: task.id });
      assert.equal(
        details.sessions.some((s) => s.id === session.id),
        caller.id !== free.id,
      );
    }
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
