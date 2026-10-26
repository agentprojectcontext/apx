import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { Harness } from "../harness/index.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { pendingInput, say, scriptedLlm, startCore } from "./testkit.ts";

const goal = { title: "One executor", description: "Finish the current work once.", assignee: "roby" };

test("an asynchronous APX tool must drain before a concurrent handoff can start a task", async () => {
  const folder = tempDir("apx-handoff-concurrent-");
  const leave = Promise.withResolvers<void>();
  let entered = false;
  let blocked = "";
  let startedWhileBusy = -1;
  let task = "";
  const claude: Harness = {
    id: "claude",
    async run(io) {
      const slow = io.execute("slow", "slow_lookup", {});
      try {
        await waitFor(() => entered, "asynchronous tool entry");
        const first = await io.execute("while-busy", "task_create", goal);
        blocked = first.text;
        assert.equal(first.ok, false);
        startedWhileBusy = env.core.store.tasks.list({ state: "open", limit: 100 }).length;
      } finally {
        leave.resolve();
        await slow;
      }
      const next = await io.execute("after-drain", "task_create", goal);
      assert.equal(next.ok, true);
      task = /created (task_\w+)/.exec(next.text)?.[1] ?? "";
      return { text: "Transferred after the operation completed.", model: "fake/fake-1" };
    },
  };
  const env = await startCore({
    llm: scriptedLlm(() => say("Ready.")),
    harnesses: { claude },
    extraTools: [
      defineTool({
        name: "slow_lookup",
        description: "Controlled asynchronous lookup",
        args: z.object({}),
        effect: "none",
        confirm: "never",
        deadlineMs: 10_000,
        title: () => "Reading",
        async run() {
          entered = true;
          await leave.promise;
          return "Existing findings.";
        },
      }),
    ],
  });
  try {
    const chat = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: (await env.client.call("projects.register", { path: folder.path, init: true })).project.id,
      cwd: folder.path,
      write: "auto",
      engine: "claude",
    });
    const sent = await env.client.call("threads.send", {
      thread: chat.id,
      text: "Drain concurrent work before transferring.",
    });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "concurrent handoff completion");
    assert.match(blocked, /another tool is still running/);
    assert.equal(startedWhileBusy, 0);
    assert.ok(task);
    assert.equal(env.core.store.threads.byTask(task).length, 1);
    assert.equal(env.core.store.runs.steps(sent.run.id).find((s) => s.call_id === "slow")?.state, "ok");
  } finally {
    leave.resolve();
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});

for (const observed of [false, true]) {
  test(`an external permission blocks handoff even ${observed ? "with an uncorrelated observation" : "before the SDK reports a tool"}, but not a later owner turn`, async () => {
    const folder = tempDir("apx-handoff-native-");
    let attempt = 0;
    let refused = "";
    let deniedTask = "";
    let successfulTask = "";
    const claude: Harness = {
      id: "claude",
      async run(io) {
        if (attempt++ === 0) {
          assert.equal(await io.approve({ callId: "permission-id", title: "Read a file", kind: "read" }), true);
          if (observed) io.observe({ callId: "sdk-tool-id", title: "Read a file", kind: "read", status: "ok" });
          const out = await io.execute("unsafe-transfer", "task_create", goal);
          refused = out.text;
          deniedTask = /created (task_\w+)/.exec(out.text)?.[1] ?? "";
          return { text: "Keep the existing native work here.", model: "fake/fake-1" };
        }
        const out = await io.execute("independent-transfer", "task_create", goal);
        assert.equal(out.ok, true);
        successfulTask = /created (task_\w+)/.exec(out.text)?.[1] ?? "";
        return { text: "Independent turn transferred.", model: "fake/fake-1" };
      },
    };
    const env = await startCore({ llm: scriptedLlm(() => say("Ready.")), harnesses: { claude } });
    try {
      const chat = await env.client.call("threads.create", {
        kind: "code",
        agent_id: "roby",
        project_id: (await env.client.call("projects.register", { path: folder.path, init: true })).project.id,
        cwd: folder.path,
        write: "auto",
        engine: "claude",
      });
      const first = await env.client.call("threads.send", {
        thread: chat.id,
        text: "Use a native tool, then try to transfer.",
      });
      await waitFor(() => Boolean(env.core.store.runs.get(first.run.id)?.ended_at), "permission handoff refusal");
      assert.match(refused, /cannot be drained safely/);
      assert.equal(deniedTask, "");
      assert.equal(env.core.store.tasks.list({ state: "open", limit: 100 }).length, 0);
      assert.equal(env.core.store.threads.context(chat.id).task_handoff, undefined);
      const second = await env.client.call("threads.send", { thread: chat.id, text: "Independent owner request." });
      await waitFor(() => Boolean(env.core.store.runs.get(second.run.id)?.ended_at), "independent transfer");
      assert.ok(successfulTask);
      assert.equal(env.core.store.threads.context(chat.id).task_handoff?.run, second.run.id);
    } finally {
      await env.core.close();
      await env.cleanup();
      await folder.remove();
    }
  });
}

test("a native permission waiting on approval is refused if handoff wins the race", async () => {
  const folder = tempDir("apx-handoff-approval-");
  let transferred = false;
  let allowed: boolean | undefined;
  let source = "";
  const claude: Harness = {
    id: "claude",
    async run(io) {
      const permission = io.approve({ callId: "pending-native", title: "Use an outside action", kind: "other" });
      await pendingInput(env.client, source);
      const out = await io.execute("transfer-first", "task_create", goal);
      transferred = out.ok;
      const input = await pendingInput(env.client, source);
      await env.client.call("runs.respond", { input: input.id, decision: "approve" });
      allowed = await permission;
      return { text: "The late native permission cannot execute.", model: "fake/fake-1" };
    },
  };
  const env = await startCore({ llm: scriptedLlm(() => say("Ready.")), harnesses: { claude } });
  try {
    const chat = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: (await env.client.call("projects.register", { path: folder.path, init: true })).project.id,
      cwd: folder.path,
      write: "auto",
      engine: "claude",
    });
    source = chat.id;
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Transfer while the approval waits." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "approval race completion");
    assert.equal(transferred, true);
    assert.equal(allowed, false);
    assert.equal(env.core.store.tasks.list({ state: "open", limit: 100 }).length, 1);
    assert.equal(env.core.store.threads.context(chat.id).external_grant_run, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});

test("a harness without a native permission intercept keeps its executor in the source chat", async () => {
  const folder = tempDir("apx-handoff-unrevocable-");
  let refused = "";
  let canContinue = false;
  const codex: Harness = {
    id: "codex",
    async run(io) {
      const out = await io.execute("unsafe-handoff", "task_create", goal);
      refused = out.text;
      canContinue = (await io.execute("continue", "task_list", {})).ok;
      return { text: "Continue here.", model: "fake/fake-1" };
    },
  };
  const env = await startCore({ llm: scriptedLlm(() => say("Ready.")), harnesses: { codex } });
  try {
    const project = await env.client.call("projects.register", { path: folder.path, init: true });
    const chat = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: project.project.id,
      cwd: folder.path,
      write: "auto",
      engine: "codex",
    });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Keep one executor." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "non-interceptable handoff refusal");
    assert.match(refused, /cannot pause its native tools safely/);
    assert.equal(canContinue, true);
    assert.equal((await env.client.call("tasks.list", {})).tasks.length, 0);
    assert.equal(env.core.store.threads.context(chat.id).task_handoff, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
