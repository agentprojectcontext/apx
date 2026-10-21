import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { realpath } from "../paths.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 200)}`);
  if (said.includes("make a file")) return callTool("m1", "shell", { command: "touch made.txt" });
  if (said.includes("write a file")) return callTool("w1", "file_write", { path: "written.txt", content: "x\n" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-code-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  fs.mkdirSync(path.join(repo, "src"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=user@example.com", "-c", "user.name=T", "add", "."], { cwd: repo });
  execFileSync("git", ["-c", "user.email=user@example.com", "-c", "user.name=T", "commit", "-qm", "init"], {
    cwd: repo,
  });
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

const lastSeen = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

test("a code thread works in a folder inside its project; outside is refused", async () => {
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    cwd: "src",
  });
  assert.equal(t.cwd, path.join(repo, "src"));
  assert.equal(t.write, "ask");
  await assert.rejects(
    env.client.call("threads.create", { kind: "code", agent_id: "roby", project_id: project, cwd: ".." }),
    (e: unknown) => e instanceof ApxError && /outside the project/.test(e.message),
  );
});

test("a read-only code thread refuses commands that change things", async () => {
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    write: "read-only",
  });
  await env.client.call("threads.send", { thread: t.id, text: "make a file" });
  await env.settle(t.id);
  assert.match(lastSeen(), /read-only; this command is not a plain read/);
  assert.ok(!fs.existsSync(path.join(repo, "made.txt")));
  // file_write never asks in its own folder, so its level alone let it through a read-only thread.
  await env.client.call("threads.send", { thread: t.id, text: "write a file" });
  await env.settle(t.id);
  assert.match(lastSeen(), /refused: this code thread is read-only/);
  assert.ok(!fs.existsSync(path.join(repo, "written.txt")));
});

test("a code thread's folder and write policy are in its turn's input and in threads.get, not in the system prompt", async () => {
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    cwd: "src",
    write: "read-only",
  });
  await env.client.call("threads.send", { thread: t.id, text: "which folder?" });
  await env.settle(t.id);
  const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("which folder?"));
  const input = String(call?.messages.at(-1)?.content);
  assert.ok(input.includes(`[workspace] Folder: ${path.join(repo, "src")} · writes: read-only (`), input);
  const system = call?.messages.find((m) => m.role === "system")?.content;
  assert.match(String(system), /^You are /);
  assert.doesNotMatch(String(system), /\[workspace\]|read-only/);
  const { thread } = await env.client.call("threads.get", { thread: t.id });
  assert.equal(thread.cwd, path.join(repo, "src"));
  assert.equal(thread.write, "read-only");
});

test("after a change, the turn ends with what git sees as uncommitted", async () => {
  const t = await env.client.call("threads.create", { kind: "code", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "make a file" });
  const { messages } = await env.settle(t.id);
  // Auto makes it where it works with no card (DECISIONS.md#d-106).
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
  const changes = messages.at(-1)?.parts.find((p) => p.type === "changes");
  assert.ok(changes?.type === "changes");
  assert.deepEqual(changes.files, [{ path: "made.txt", status: "??" }]);
});

test("reading the folder's git state runs nothing the repo's config names", async () => {
  const marker = path.join(repo, "..", `fsmonitor-ran-${path.basename(repo)}`);
  execFileSync("git", ["config", "core.fsmonitor", `touch ${marker}`], { cwd: repo });
  const { gitChanges } = await import("./changes.ts");
  await gitChanges(repo);
  assert.ok(!fs.existsSync(marker));
  execFileSync("git", ["config", "--unset", "core.fsmonitor"], { cwd: repo });
});
