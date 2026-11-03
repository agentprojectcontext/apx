import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("a read-only agent can verify the exact committed file without trusting the working copy", async () => {
  let args: Record<string, unknown> = {};
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("read", "file_read_revision", args),
  );
  const env = await startCore({ llm });
  try {
    const repo = path.join(env.home, "work");
    fs.mkdirSync(repo, { recursive: true });
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
    git("init");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(repo, "spec.md"), "approved content\n");
    git("add", "spec.md");
    git("commit", "-m", "approved");
    const commit = git("rev-parse", "HEAD"),
      blob = git("rev-parse", "HEAD:spec.md");
    fs.writeFileSync(path.join(repo, "spec.md"), "stale different content\n");
    await env.client.call("agents.update", {
      agent: "superagent",
      autonomy: "auto",
      tools: ["file_read_revision"],
      rules: { outside: "off" },
    });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    async function read(a: Record<string, unknown>) {
      args = a;
      await env.client.call("threads.send", { thread: chat.id, text: "Read" });
      await env.settle(chat.id);
      return String(llm.calls.at(-1)?.messages.at(-1)?.content);
    }
    const exact = await read({ path: "spec.md", revision: commit });
    assert.match(exact, /approved content/);
    assert.doesNotMatch(exact, /stale different content/);
    assert.match(exact, new RegExp(commit));
    assert.match(exact, new RegExp(blob));
    const invalid = await read({ path: "spec.md", revision: "HEAD" });
    assert.doesNotMatch(invalid, /stale different content/);
    assert.match(invalid, /revision|invalid|full/i);
    const missing = await read({ path: "spec.md", revision: "0".repeat(40) });
    assert.doesNotMatch(missing, /stale different content/);
    assert.match(missing, /missing|not found|unavailable|refused|error/i);
    const outside = await read({ path: "../outside.md", revision: commit });
    assert.match(outside, /outside|refused/i);
    // A linked worktree can read a tracked path even after that path was removed locally.
    const tree = path.join(repo, ".worktrees", "review");
    fs.mkdirSync(path.dirname(tree), { recursive: true });
    git("worktree", "add", "-b", "review", tree, "HEAD");
    fs.unlinkSync(path.join(tree, "spec.md"));
    const linked = await read({ path: "spec.md", cwd: ".worktrees/review", revision: commit });
    assert.match(linked, /approved content/);
    assert.match(linked, new RegExp(blob));
    const oldGitDir = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = path.join(env.home, "bogus-git");
      assert.match(await read({ path: "spec.md", revision: commit }), /approved content/);
    } finally {
      if (oldGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = oldGitDir;
    }
    // Local replace refs cannot change the content of the immutable commit requested.
    fs.writeFileSync(path.join(repo, "spec.md"), "replacement content\n");
    git("add", "spec.md");
    git("commit", "-m", "replacement");
    const replacement = git("rev-parse", "HEAD");
    git("replace", commit, replacement);
    assert.match(await read({ path: "spec.md", revision: commit }), /approved content/);
    git("replace", "-d", commit);
    const alternates = path.join(repo, ".git", "objects", "info", "alternates");
    fs.writeFileSync(alternates, `${path.join(env.home, "outside-objects")}\n`);
    assert.match(await read({ path: "spec.md", revision: commit }), /alternate object stores/i);
    fs.unlinkSync(alternates);
    // Missing, binary and oversized blobs fail closed without reading the working copy instead.
    fs.writeFileSync(path.join(repo, "binary.dat"), Buffer.from([65, 0, 66]));
    fs.writeFileSync(path.join(repo, "large.txt"), "x".repeat(1_000_001));
    git("add", "binary.dat", "large.txt");
    git("commit", "-m", "binary and large");
    const tip = git("rev-parse", "HEAD");
    assert.match(await read({ path: "binary.dat", revision: tip }), /not a text file/i);
    assert.match(await read({ path: "large.txt", revision: tip }), /exceeds/i);
    fs.writeFileSync(path.join(env.home, "outside.md"), "secret outside");
    fs.symlinkSync(path.join(env.home, "outside.md"), path.join(repo, "escape.md"));
    const escaped = await read({ path: "escape.md", revision: tip });
    assert.match(escaped, /outside|refused|home/i);
    assert.doesNotMatch(escaped, /secret outside/);
    await env.client.call("agents.update", { agent: "superagent", tools: ["file_read"] });
    await read({ path: "spec.md", revision: commit });
    const offered = llm.calls.at(-1)?.tools.map((tool) => tool.function.name) ?? [];
    assert.ok(offered.includes("file_read"));
    assert.ok(!offered.includes("file_read_revision"), "historical access is separately granted");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
