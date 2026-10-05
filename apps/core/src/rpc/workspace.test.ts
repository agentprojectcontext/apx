import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let thread = "";
let bare = "";
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=dev@example.com", "-C", repo, ...args]);

before(async () => {
  env = await startCore({
    llm: scriptedLlm((_req, { said, afterTool }) =>
      !afterTool && said.includes("run echo") ? callTool("c1", "shell", { command: "echo from-agent" }) : say("ok"),
    ),
  });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-ws-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "one\ntwo\nthree\n");
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "start");
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project })).id;
  bare = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("a project chat's Changes list what is uncommitted, each file with its diff", async () => {
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "one\n2\nthree\n");
  fs.writeFileSync(path.join(repo, "notes.md"), "new\n");
  const r = await env.client.call("files.changes", { thread });
  assert.equal(r.git, true);
  assert.deepEqual(r.files.map((f) => [f.path, f.status, f.added ?? null, f.removed ?? null]).sort(), [
    ["notes.md", "??", null, null],
    ["src/app.ts", "M", 1, 1],
  ]);
  const d = await env.client.call("files.diff", { thread, path: "src/app.ts" });
  assert.match(d.diff, /^-two$/m);
  assert.match(d.diff, /^\+2$/m);
  assert.match((await env.client.call("files.diff", { thread, path: "notes.md" })).diff, /^\+new$/m);
  await assert.rejects(env.client.call("files.diff", { thread, path: "../outside" }), /outside the folder/);
  await assert.rejects(env.client.call("files.changes", { thread: bare }), /no folder/);
});

test("a terminal runs the owner's commands in the chat's folder and keeps what it printed", async () => {
  const t = await env.client.call("terminal.open", { thread, cols: 80, rows: 24 });
  assert.equal(t.cwd, repo);
  await env.client.call("terminal.input", { terminal: t.id, data: "echo ready-$((40+2)) && pwd\r" });
  let backlog = "";
  for (let i = 0; i < 100 && !backlog.includes("ready-42"); i++) {
    await new Promise((r) => setTimeout(r, 50));
    backlog = (await env.client.call("terminal.attach", { terminal: t.id })).backlog;
  }
  assert.match(backlog, /ready-42/);
  assert.ok(backlog.includes(repo), "it ran in the project's folder");
  await env.client.call("terminal.resize", { terminal: t.id, cols: 100, rows: 30 });
  assert.equal((await env.client.call("terminal.list", { thread })).terminals.length, 1);
  await env.client.call("terminal.close", { terminal: t.id });
  assert.equal((await env.client.call("terminal.list", { thread })).terminals.length, 0);
  await assert.rejects(env.client.call("terminal.open", { thread: bare, cols: 80, rows: 24 }), /no folder/);
});

test("any project chat can work in its folder with a write policy, like a code session, and stop", async () => {
  const t = await env.client.call("threads.update", { thread, write: "read-only" });
  assert.deepEqual([t.cwd, t.write, t.kind], [repo, "read-only", "loose"]);
  const off = await env.client.call("threads.update", { thread, write: null });
  assert.deepEqual([off.cwd, off.write], [undefined, undefined]);
  await assert.rejects(env.client.call("threads.update", { thread: bare, write: "ask" }), /folder is on disk/);
  const code = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: (await env.client.call("threads.get", { thread })).thread.project_id,
  });
  await assert.rejects(env.client.call("threads.update", { thread: code.id, write: null }), /always works/);
});

test("the commands the agent ran in a chat are listed for that chat alone", async () => {
  await env.client.call("threads.send", { thread, text: "run echo" });
  await env.settle(thread, 15_000);
  const mine = await env.client.call("jobs.list", { thread, finished: 10 });
  const job = mine.finished[0];
  assert.ok(job, "the command is listed");
  assert.match(job.title, /echo from-agent/);
  assert.match((await env.client.call("jobs.get", { job: job.id })).output, /from-agent/);
  const other = await env.client.call("jobs.list", { thread: bare, finished: 10 });
  assert.deepEqual([other.running.length, other.finished.length], [0, 0]);
});
