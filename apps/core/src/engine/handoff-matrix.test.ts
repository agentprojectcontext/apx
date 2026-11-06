// The same behavior must hold across independent projects and agent identities, not only one office's roster.
import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const [label, tryCycle, unassigned, twoRounds] of [
  ["Alpha", false, false, false],
  ["Beta", false, false, false],
  ["Gamma", true, false, false],
  ["Delta", false, true, false],
  ["Echo", false, false, true],
] as const) {
  test(`${label}: owner coordination starts work, review and bounded return across a deep historical tree`, async () => {
    const project = `matrix-${label.toLowerCase()}`;
    const lead = `${project}-lead`,
      dev = `${project}-dev`,
      qa = `${project}-qa`;
    let devTurns = 0;
    const llm = scriptedLlm((req, { system, said, afterTool }) => {
      if (afterTool) return say("Done with this step.");
      const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? /task_\w+/.exec(said)?.[0] ?? "";
      if (system.startsWith(`You are ${label} Lead`)) return callTool("assign", "task_update", { task, assignee: dev });
      if (system.startsWith(`You are ${label} Developer`)) {
        devTurns++;
        return devTurns === 1 || (twoRounds && devTurns === 2)
          ? callTool("review", "task_update", { task, status: "review", assignee: qa })
          : tryCycle
            ? callTool("repeat-review", "task_update", { task, status: "review", assignee: qa })
            : say("Review received; awaiting the owner.");
      }
      if (system.startsWith(`You are ${label} Reviewer`))
        return callTool("return", "task_update", { task, status: "review", assignee: dev });
      return say("ok");
    });
    const env = await startCore({ llm });
    try {
      const store = env.core.store;
      store.projects.upsert({ id: project, name: label });
      for (const [id, name, parent, isLead] of [
        [lead, `${label} Lead`, undefined, true],
        [dev, `${label} Developer`, lead, false],
        [qa, `${label} Reviewer`, lead, false],
      ] as const)
        store.agents.upsertApc({
          id,
          name,
          parent,
          project_id: project,
          slug: id,
          role: name,
          prompt: "",
          extra: isLead ? { orchestrator: true } : {},
        });
      const old = (title: string, parent?: string) =>
        store.tasks.create({
          title,
          status: "todo",
          project_id: project,
          parent_id: parent,
          thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
          by: dev,
        });
      const a = old("Historical root"),
        b = old("Historical stage", a.id),
        c = old("Historical work", b.id);
      const task = store.tasks.create({
        title: "Bounded product work",
        description: "Implement, review, and return the result.",
        status: "doing",
        project_id: project,
        parent_id: c.id,
        ...(unassigned ? {} : { assignee: lead }),
        thread_id: store.threads.create({
          kind: "task",
          title: "Bounded product work",
          project_id: project,
          agent_ids: [lead],
        }).id,
        by: dev,
      });
      const chat = await env.client.call("threads.create", {
        kind: "loose",
        title: "Owner request",
        agent_id: lead,
        project_id: project,
      });
      await env.client.call("threads.send", { thread: chat.id, text: `coordinate ${task.id}` });
      await waitFor(
        () =>
          store.threads
            .byTask(task.id)
            .flatMap((t) => store.runs.list(t.id, 30))
            .filter((r) => r.agent_id === dev && r.ended_at).length >= (twoRounds || tryCycle ? 3 : 2),
        "review returned to author",
      );
      const current = store.tasks.get(task.id);
      const runs = store.threads.byTask(task.id).flatMap((t) => store.runs.list(t.id, 30));
      if (tryCycle) {
        assert.equal(current?.proposed, true, "a further review cycle requires owner approval");
        assert.equal(runs.filter((r) => r.agent_id === qa).length, 2, "a third reviewer does not start");
      } else {
        assert.notEqual(current?.proposed, true);
        assert.equal(current?.assignee, dev);
      }
      assert.ok(runs.filter((r) => r.agent_id === qa && r.state === "completed").length >= (twoRounds ? 2 : 1));
      assert.ok(runs.filter((r) => r.agent_id === dev && r.state === "completed").length >= 2);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
