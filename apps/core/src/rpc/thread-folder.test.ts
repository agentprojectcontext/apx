import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { samePath } from "../paths.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

test("changing a code session folder stays within its project and waits for its turn to finish", async () => {
  await using dir = tempDir("apx-thread-folder-");
  await using outside = tempDir("apx-outside-folder-");
  const child = path.join(dir.path, "checkout");
  const file = path.join(dir.path, "file.txt");
  fs.mkdirSync(child);
  fs.writeFileSync(file, "not a folder");
  let release: (() => void) | undefined;
  const env = await startCore({
    llm: scriptedLlm(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return say("ok");
    }),
  });
  try {
    const { client } = env;
    const { project } = await client.call("projects.register", { path: dir.path, init: true });
    const thread = await client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project.id,
      cwd: child,
      write: "read-only",
    });
    for (const cwd of [outside.path, file, path.join(dir.path, "missing")])
      await assert.rejects(client.call("threads.update", { thread: thread.id, cwd }));
    await assert.rejects(client.call("threads.update", { thread: "home", cwd: child }), /only a code session/);
    await assert.rejects(
      client.call("threads.update", { thread: thread.id, cwd: dir.path, write: null }),
      /always works in its folder/,
    );
    assert.ok(samePath((await client.call("threads.get", { thread: thread.id })).thread.cwd ?? "", child));
    await client.call("threads.send", { thread: thread.id, text: "hold" });
    await waitFor(() => release !== undefined, "the turn to start");
    await assert.rejects(client.call("threads.update", { thread: thread.id, cwd: dir.path }), /stop it first/);
    release?.();
    await env.settle(thread.id);
    const before = await client.call("threads.get", { thread: thread.id });
    const changed = await client.call("threads.update", { thread: thread.id, cwd: dir.path });
    assert.ok(samePath(changed.cwd ?? "", dir.path));
    assert.equal(changed.write, "read-only");
    assert.equal(changed.id, thread.id);
    assert.deepEqual((await client.call("threads.get", { thread: thread.id })).messages, before.messages);
  } finally {
    release?.();
    await env.core.close();
    await env.cleanup();
  }
});
