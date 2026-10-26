import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Harness } from "../harness/index.ts";
import { assertPath, tempDir, waitFor } from "../testkit/platform.ts";
import { reportClose } from "./task-report.ts";
import { startScheduled } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const workspace of ["read-only", "no folder"] as const) {
  test(`an update handoff from ${workspace} never reuses an older writable task session`, async () => {
    const folder = tempDir("apx-handoff-session-");
    const previousFolder = path.join(folder.path, "previous");
    const currentFolder = path.join(folder.path, "current");
    fs.mkdirSync(previousFolder);
    fs.mkdirSync(currentFolder);
    let task = "";
    const llm = scriptedLlm((_req, { said, afterTool }) => {
      if (said.includes("Take this existing task.") && !afterTool)
        return callTool("take-task", "task_update", { task, assignee: "roby" });
      return say("Ready.");
    });
    const env = await startCore({ llm });
    try {
      const project = await env.client.call("projects.register", { path: folder.path, init: true });
      const draft = await env.client.call("tasks.create", {
        title: "Existing task",
        description: "Finish once.",
        project: project.project.id,
      });
      task = draft.id;
      const prior = env.core.store.threads.create({
        kind: "loose",
        title: "Previous work",
        task_id: task,
        project_id: project.project.id,
        agent_ids: ["roby"],
        cwd: previousFolder,
        write: "auto",
      });
      env.core.store.tasks.change(task, { assignee: "vera" }, "owner");
      const chat = await env.client.call("threads.create", {
        kind: workspace === "read-only" ? "code" : "loose",
        agent_id: "roby",
        project_id: project.project.id,
        ...(workspace === "read-only" ? { cwd: currentFolder, write: "read-only" as const } : {}),
      });
      const sent = await env.client.call("threads.send", { thread: chat.id, text: "Take this existing task." });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "task update transfer");
      assert.ok(env.core.store.threads.context(chat.id).task_handoff);
      const sessions = env.core.store.threads.byTask(task);
      assert.equal(sessions.length, 2);
      const current = sessions.find((s) => s.id !== prior.id);
      assert.ok(current);
      assert.equal(env.core.store.threads.get(prior.id)?.write, "auto");
      assertPath(env.core.store.threads.get(prior.id)?.cwd, previousFolder);
      if (workspace === "read-only") {
        assertPath(current.cwd, currentFolder);
        assert.equal(current.write, "read-only");
      } else {
        assert.equal(current.cwd, undefined);
        assert.equal(current.write, undefined);
      }
      assert.equal(env.core.store.runs.list(prior.id).length, 0, "previous execution context stays untouched");
    } finally {
      await env.core.close();
      await env.cleanup();
      await folder.remove();
    }
  });
}

for (const creator of ["roby", "vera", "owner"] as const) {
  test(`an update handoff reports to its current source, independently of the ${creator} creation event`, async () => {
    let task = "";
    const llm = scriptedLlm((req, { said, afterTool }) => {
      const raw = String(
        req.messages.findLast((m) => m.role === "user" && !String(m.content).startsWith("<system_note>"))?.content,
      );
      if (said.includes("<task_result")) return say("Delivered to the right chat.");
      if (raw.includes("Existing work transferred")) {
        if (!afterTool)
          return callTool("finish", "task_close", { task, state: "done", note: "Update transfer complete." });
        return say("Finished.");
      }
      if (said.includes("Seed a draft")) {
        if (!afterTool) return callTool("seed", "task_create", { title: "Update delivery task" });
        task = /created (task_\w+)/.exec(String(req.messages.at(-1)?.content))?.[1] ?? "";
        return say("Draft saved.");
      }
      if (!afterTool)
        return callTool("take", "task_update", { task, assignee: "roby", description: "Finish once through update." });
      return say("Transferred.");
    });
    const env = await startCore({ llm });
    try {
      let original = "";
      if (creator === "owner") task = (await env.client.call("tasks.create", { title: "Update delivery task" })).id;
      else {
        original = (await env.client.call("threads.create", { kind: "loose", agent_id: creator })).id;
        const seed = await env.client.call("threads.send", { thread: original, text: "Seed a draft" });
        await waitFor(() => Boolean(env.core.store.runs.get(seed.run.id)?.ended_at), "draft creation");
      }
      assert.ok(task);
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      const sent = await env.client.call("threads.send", { thread: chat.id, text: "Take the draft now." });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "update transfer source");
      await waitFor(() => env.core.store.tasks.get(task)?.state === "done", "task delivery");
      await waitFor(
        () =>
          env.core.store.runs
            .list(chat.id)
            .find((r) => r.input?.origin.kind === "task_result" && r.state === "completed"),
        "report to current handoff source",
      );
      const reports = (id: string) =>
        env.core.store.runs.list(id).filter((r) => r.input?.origin.kind === "task_result");
      assert.equal(reports(chat.id).length, 1);
      assert.match(reports(chat.id)[0]?.input?.text ?? "", /Update transfer complete/);
      if (creator === "vera") {
        await waitFor(() => reports(original).some((r) => r.state === "completed"), "historical creator notification");
        assert.equal(reports(original).length, 1);
      } else if (creator === "roby") assert.equal(reports(original).length, 0);
      assert.equal(reportClose(env.core.store, env.core.engine.admit, task), undefined);
      assert.equal(reports(chat.id).length, 1, "the same close is reported once");
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

for (const delegated of [false, true]) {
  test(`a due task does not transfer its still-running creator${delegated ? " after delegation" : ""}`, async () => {
    const folder = tempDir("apx-handoff-schedule-");
    let ready = false;
    const leave = Promise.withResolvers<void>();
    let task = "";
    let after = false;
    const claude: Harness = {
      id: "claude",
      async run(io) {
        const conversation = env.core.store.threads.create({
          kind: "task",
          title: "Future work",
          agent_ids: ["roby"],
          project_id: io.thread.project_id,
        });
        task = env.core.store.tasks.create({
          title: "Future work",
          description: "Start only on the office clock.",
          status: "todo",
          assignee: "roby",
          project_id: io.thread.project_id,
          start_at: "2000-01-01T10:00:00.000Z",
          thread_id: conversation.id,
          by: "roby",
          from: { thread: io.thread.id, run: io.run.id },
        }).id;
        if (delegated)
          await io.execute("existing-helper", "delegate", {
            worker: { name: "Existing helper", instructions: "Answer once." },
            task: "Keep existing work.",
            wait_s: 0,
          });
        ready = true;
        await leave.promise;
        after = (await io.execute("after-tick", "task_list", {})).ok;
        return { text: "Scheduled; original work can continue.", model: "fake/fake-1" };
      },
    };
    const env = await startCore({
      llm: scriptedLlm(() => say("Ready.")),
      harnesses: { claude },
      clock: () => new Date("2000-01-01T09:00:00.000Z"),
    });
    try {
      const project = await env.client.call("projects.register", { path: folder.path, init: true });
      const chat = await env.client.call("threads.create", {
        kind: "code",
        agent_id: "roby",
        project_id: project.project.id,
        cwd: folder.path,
        write: "auto",
        engine: "claude",
      });
      const sent = await env.client.call("threads.send", {
        thread: chat.id,
        text: "Schedule work and keep this turn open.",
      });
      await waitFor(() => ready, "scheduled task creation");
      assert.ok(task);
      assert.deepEqual(startScheduled(env.core.store, env.core.engine.admit, new Date("2000-01-01T09:59:00.000Z")), []);
      const started = startScheduled(env.core.store, env.core.engine.admit, new Date("2000-01-01T10:00:00.000Z"));
      assert.equal(started.length, 1);
      assert.equal(env.core.store.threads.context(chat.id).task_handoff, undefined);
      assert.equal(env.core.store.threads.context(started[0]?.thread_id ?? "").handoff_from, undefined);
      leave.resolve();
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "scheduled creator completion");
      assert.equal(after, true);
    } finally {
      leave.resolve();
      await env.core.close();
      await env.cleanup();
      await folder.remove();
    }
  });
}
