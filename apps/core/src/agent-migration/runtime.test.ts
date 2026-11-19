import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import type { CallContext } from "../rpc/context.ts";
import { manualTimers, tempDir } from "../testkit/platform.ts";
import { folderAccess } from "../tools/folders.ts";
import { migrationRuntimeFixture } from "./runtime-fixture.ts";

test("the running core moves shared work through the protocol and fences source search, notes, attachments and delegation", async () => {
  const dir = tempDir("apx-migration-runtime-");
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(`Search result: ${String(req.messages.at(-1)?.content)}`);
    if (said === "Find the old report") return callTool("search-report", "search_chats", { query: "migration report" });
    return say("Checked the project context.");
  });
  const env = await startCore({ llm, projectWatchTimers: manualTimers() });
  try {
    const { sourceRoot, targetRoot, source, target, researcher, editor, store, shared, task, own, note, media } =
      await migrationRuntimeFixture(env, dir.path);
    const formerlyGlobal = store.memories.add({
      scope: "global",
      text: "project-only-memory-marker",
      source: "owner",
      thread_id: own.id,
    });
    const sourceChat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: editor.id,
      project_id: source.id,
    });
    await env.client.call("threads.send", { thread: sourceChat.id, text: "Check the original context" });
    await env.settle(sourceChat.id);
    assert.match(
      JSON.stringify(llm.calls.at(-1)?.messages),
      /project-only-memory-marker/,
      "the old model history contains the formerly global note",
    );
    const input = { agent: researcher.id, destination: target.id, paths: ["reports"] };
    const preview = await env.client.call("agents.migration_preview", input);
    assert.deepEqual(preview.blockers, []);
    assert.ok(preview.shared_tasks.includes(task.id));
    const params = { ...input, id: preview.id, revision: preview.revision };
    const denied = await env.core.dispatch(
      "agents.migrate",
      params,
      {
        transport: "internal",
        role: "operator",
        actor: "agent",
        session: undefined,
        log: { info() {}, warn() {}, error() {} },
      },
      "unapproved-migration",
    );
    assert.equal(denied.ok, false, "an agent cannot bypass the owner's migration confirmation");
    const moved = await env.client.call("agents.migrate", params);
    assert.equal(moved.state, "committed");
    assert.equal(store.agents.get(researcher.id)?.project_id, target.id);
    assert.equal(store.memories.get(note.id)?.project_id, target.id);
    assert.equal(fs.existsSync(path.join(sourceRoot, "reports", "result.txt")), false);
    assert.equal(fs.readFileSync(path.join(targetRoot, "reports", "result.txt"), "utf8"), "Destination-only findings");
    assert.equal(store.memories.get(formerlyGlobal.id)?.scope, "project");
    assert.equal(store.memories.get(formerlyGlobal.id)?.project_id, target.id);
    const sourceRun = store.runs.create({
      agent_id: editor.id,
      thread_id: sourceChat.id,
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Check access" },
      deadline_at: "2099-01-01T00:00:00.000Z",
    });
    store.runs.setState(sourceRun, "working");
    const ctx: CallContext = {
      transport: "internal",
      role: "operator",
      actor: "agent",
      session: undefined,
      agent: { id: editor.id, run_id: sourceRun.id, thread_id: sourceChat.id },
      log: { info() {}, warn() {}, error() {} },
    };
    for (const method of ["threads.get", "tasks.get", "media.get"] as const) {
      const argument =
        method === "threads.get"
          ? { thread: shared.id }
          : method === "tasks.get"
            ? { task: task.id }
            : { id: media.id };
      const result = await env.core.dispatch(method, argument, ctx);
      assert.equal(result.ok, false, `${method} does not expose the destination's work`);
    }
    const list = await env.core.dispatch("threads.list", {}, ctx);
    assert.equal(list.ok, true);
    assert.doesNotMatch(JSON.stringify(list), /Migration report|Destination-only findings/);
    const targetChat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: researcher.id,
      project_id: target.id,
    });
    assert.throws(
      () =>
        env.core.engine.admit({
          thread_id: targetChat.id,
          agent_id: researcher.id,
          trigger: "a2a",
          origin: { kind: "agent", id: editor.id, name: "Editor", thread_id: sourceChat.id, run_id: sourceRun.id },
          text: "Read the old report",
        }),
      /own team/,
    );
    const view = {
      ...sourceChat,
      reach: "all" as const,
      principal: { project: source.id, owner: false },
      lent: [targetRoot],
      lentWrite: true,
      granted: [targetRoot],
      cwd: targetRoot,
    };
    assert.ok(
      "refused" in folderAccess(store, env.home, view, path.join(targetRoot, "reports", "result.txt")),
      "even a stale cwd, lent folder and All reach do not reopen the protected project",
    );
    store.runs.setState(sourceRun, "completed");
    await env.client.call("threads.send", { thread: sourceChat.id, text: "Find the old report" });
    const found = await env.settle(sourceChat.id);
    assert.doesNotMatch(texts(found.messages).join("\n"), /Destination-only findings|destination-private-note/);
    assert.doesNotMatch(
      JSON.stringify(llm.calls.at(-1)?.messages),
      /destination-private-note|project-only-memory-marker/,
      "neither new recall nor the old persisted model snapshot leaks the moved notes",
    );
    await env.client.call("threads.send", { thread: targetChat.id, text: "Check the destination context" });
    await env.settle(targetChat.id);
    const context = JSON.stringify(llm.calls.at(-1)?.messages);
    assert.match(context, /destination-private-note/);
    assert.match(context, /northwind-context-marker/);
    assert.doesNotMatch(context, /acme-context-marker/);
    const after = (await env.client.call("agents.list", {})).agents.filter((a) => a.slug === "researcher");
    assert.equal(after.length, 1);
    assert.equal(after[0]?.id, researcher.id);
  } finally {
    await env.core.close();
    await env.cleanup();
    await dir.remove();
  }
});
