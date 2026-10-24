import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { FILE_READ_LIMIT, type Part } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { afterTool }) => {
  if (!afterTool) return callTool("write", "file_write", { path: "Net.md", content: "Temporary\n" });
  const calls = req.messages.filter((m) => m.role === "tool").length;
  if (calls === 1) return callTool("edit", "file_edit", { path: "Net.md", old: "Temporary", new: "Final" });
  return say("Done");
});
let env: Awaited<ReturnType<typeof startCore>>;
let work: string;
before(async () => {
  env = await startCore({ llm });
  work = path.join(env.home, "work");
  fs.mkdirSync(work, { recursive: true });
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function record(file: string, cwd = work, author: "agent" | "user" = "agent") {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const message = env.core.store.messages.add({
    thread_id: thread.id,
    author: author === "agent" ? { kind: "agent", id: "roby" } : { kind: "user" },
    parts: [{ type: "changes", cwd, edits: true, files: [{ path: file, status: "M" }] }],
  });
  return { thread: thread.id, message: message.id, path: file, part: 0 };
}

test("legacy records read labeled current text, bounded, only for their chat's recorded file", async () => {
  fs.writeFileSync(path.join(work, "Old.txt"), "Current text\n");
  const params = await record("Old.txt");
  assert.deepEqual(await env.client.call("files.diff", params), {
    path: "Old.txt",
    diff: "Current text\n",
    truncated: false,
    source: "current",
  });
  fs.writeFileSync(path.join(work, "Old.txt"), "x".repeat(FILE_READ_LIMIT + 1));
  const long = await env.client.call("files.diff", params);
  assert.equal(long.diff.length, FILE_READ_LIMIT);
  assert.equal(long.truncated, true);
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await assert.rejects(env.client.call("files.diff", { ...params, thread: other.id }), /not found/);
  await assert.rejects(env.client.call("files.diff", { ...params, path: "Unrecorded.txt" }), /not found/);
  await assert.rejects(env.client.call("files.diff", { ...params, part: 1 }), /not found/);
  await assert.rejects(env.client.call("files.diff", await record("Old.txt", work, "user")), /not found/);
  await assert.rejects(
    new ApxClient({ url: env.core.url, actor: "agent" }).call("files.diff", params),
    /reserved to the owner/,
  );
});

test("legacy reads refuse changed folders, traversal, metadata aliases, binaries and pipes", async () => {
  fs.writeFileSync(path.join(env.home, "Private.txt"), "Private");
  fs.symlinkSync(path.join(env.home, "Private.txt"), path.join(work, "Escape.txt"));
  fs.mkdirSync(path.join(work, ".git"));
  fs.writeFileSync(path.join(work, ".git", "secret"), "Private");
  fs.symlinkSync(path.join(work, ".git"), path.join(work, "metadata"));
  fs.writeFileSync(path.join(work, "Binary.txt"), Buffer.from([0, 65]));
  // Named pipes are a POSIX file kind; Windows has none to refuse.
  const fifo = process.platform !== "win32";
  if (fifo) execFileSync("mkfifo", [path.join(work, "pipe")]);
  for (const file of [
    "../Private.txt",
    path.join(env.home, "Private.txt"),
    "Escape.txt",
    ".git/secret",
    ".GIT/secret",
    "metadata/secret",
    "Binary.txt",
    ...(fifo ? ["pipe"] : []),
    ".",
  ]) {
    await assert.rejects(env.client.call("files.diff", await record(file)), /outside|text file|regular file/);
  }
  await assert.rejects(env.client.call("files.diff", await record("Old.txt", env.home)), /outside/);
});

test("repeated edits persist the net patch, survive deletion and restart, and never overwrite it with Git summary", async () => {
  const repo = path.join(env.home, "project");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Test project\n");
  execFileSync("git", ["init", "-q", repo]);
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  const thread = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    write: "auto",
  });
  await env.client.call("threads.send", { thread: thread.id, text: "Write and revise" });
  const result = await env.settle(thread.id);
  assert.equal(result.runs[0]?.state, "completed");
  const message = result.messages.at(-1);
  assert.ok(message);
  const parts = message.parts.filter((p): p is Extract<Part, { type: "changes" }> => p.type === "changes");
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.edits, true);
  assert.deepEqual(
    parts[0]?.files.map(({ path, added, removed }) => ({ path, added, removed })),
    [{ path: "Net.md", added: 1, removed: 0 }],
  );
  const params = { thread: thread.id, message: message.id, path: "Net.md" };
  const saved = await env.client.call("files.diff", params);
  assert.equal(saved.source, "recorded");
  assert.match(saved.diff, /^\+Final$/m);
  assert.doesNotMatch(saved.diff, /Temporary/);
  fs.unlinkSync(path.join(repo, "Net.md"));
  assert.deepEqual(await env.client.call("files.diff", params), saved);
  await env.core.close();
  env = await startCore({ llm, home: env.home });
  assert.deepEqual(await env.client.call("files.diff", params), saved);
});
