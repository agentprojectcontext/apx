import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

const llm = scriptedLlm((_req, { said, afterTool }) =>
  !afterTool && said.includes("run echo") ? callTool("c1", "shell", { command: "echo from-agent" }) : say("ok"),
);
let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let thread = "";
let bare = "";
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=dev@example.com", "-C", repo, ...args]);

before(async () => {
  env = await startCore({ llm });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ws-")));
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
  await env.cleanup();
  await removeDir(repo);
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
  // A chat with no project works in APX's work folder, not a repository.
  assert.equal((await env.client.call("files.changes", { thread: bare })).git, false);
});

test("a terminal runs the owner's commands in the chat's folder and keeps what it printed", async () => {
  const t = await env.client.call("terminal.open", { thread, cols: 80, rows: 24 });
  assert.equal(t.cwd, repo);
  // The shell itself works out 42 (the typed line only says how), in sh or in Windows' cmd.
  const line =
    process.platform === "win32"
      ? "set /a X=40+2 >nul && call echo ready-%X% && cd\r"
      : "echo ready-$((40+2)) && pwd\r";
  await env.client.call("terminal.input", { terminal: t.id, data: line });
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
  // A chat with no folder opens it where its agent runs commands: APX's work folder.
  const loose = await env.client.call("terminal.open", { thread: bare, cols: 80, rows: 24 });
  assert.equal(loose.cwd, path.join(env.home, "work"));
  await env.client.call("terminal.close", { terminal: loose.id });
});

test("a command an agent suggested runs in its own terminal, and its end wakes that agent with the output", async () => {
  await env.client.call("threads.send", { thread, text: "suggest a command" });
  const { messages } = await env.settle(thread);
  const suggestion = messages.findLast((m) => m.author.kind === "agent");
  assert.ok(suggestion);
  const project_id = (await env.client.call("threads.get", { thread })).thread.project_id;
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id });
  await assert.rejects(
    env.client.call("terminal.open", { thread: other.id, cols: 80, rows: 24, command: "true", message: suggestion.id }),
    /not in this chat/,
  );
  const before = (await env.client.call("threads.get", { thread })).runs.length;
  const t = await env.client.call("terminal.open", {
    thread,
    cols: 80,
    rows: 24,
    command: "echo suggested-$((40+2)) && exit 3",
    message: suggestion.id,
  });
  assert.equal(t.command, "echo suggested-$((40+2)) && exit 3");
  let runs = before;
  for (let i = 0; i < 100 && runs === before; i++) {
    await new Promise((r) => setTimeout(r, 50));
    runs = (await env.client.call("threads.get", { thread })).runs.length;
  }
  await env.settle(thread);
  assert.equal(runs, before + 1);
  const seen = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(seen, /suggested-42/);
  assert.match(seen, /exit_code="3"/);
  assert.match(seen, /The owner ran the command you suggested/);
  const ended = (await env.client.call("terminal.list", { thread })).terminals.find((x) => x.id === t.id);
  assert.equal(ended?.alive, false);
  assert.equal(ended?.exit_code, 3);
  await env.client.call("terminal.close", { terminal: t.id });

  // A command the owner runs with no agent's block behind it wakes nobody.
  const alone = await env.client.call("terminal.open", { thread, cols: 80, rows: 24, command: "true" });
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 30));
    const x = (await env.client.call("terminal.list", { thread })).terminals.find((y) => y.id === alone.id);
    if (!x?.alive) break;
  }
  assert.equal((await env.client.call("threads.get", { thread })).runs.length, before + 1);
  await env.client.call("terminal.close", { terminal: alone.id });
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
