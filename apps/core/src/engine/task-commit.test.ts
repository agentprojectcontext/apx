import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Vera fixes sum.js in a worktree of the project and closes before committing; then commits and closes again.
const taskOf = (s: string) => /(task_\w+)/.exec(s)?.[1] ?? "";
const llm = scriptedLlm(async (req, { system }) => {
  if (!system.startsWith("You are Vera")) return say("ok");
  const all = JSON.stringify(req.messages);
  const task = taskOf(/Task (task_\w+)/.exec(all)?.[0] ?? all);
  const tools = req.messages.filter((m) => m.role === "tool").length;
  const cwd = ".worktrees/sum";
  const close = (id: string) =>
    callTool(id, "task_close", { task, state: "done", note: "npm test passes, sum(2, 3) is 5" });
  if (all.includes("Fix the sum, commit late")) {
    if (tools === 0)
      return callTool("w", "file_write", { path: "sum.js", cwd, content: "export const sum = (a, b) => a + b;\n" });
    if (tools === 1) return close("c1");
    if (tools === 2) return callTool("g", "shell", { command: "git add -A && git commit -qm 'fix: sum adds'", cwd });
    if (tools === 3) return close("c2");
    return say("Done.");
  }
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
const repo = tempDir();
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
before(async () => {
  env = await startCore({ llm });
  g(repo.path, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo.path, "sum.js"), "export const sum = (a, b) => a - b;\n");
  g(repo.path, "-c", "user.name=Acme", "-c", "user.email=dev@example.com", "add", "-A");
  g(repo.path, "-c", "user.name=Acme", "-c", "user.email=dev@example.com", "commit", "-qm", "init");
  g(repo.path, "config", "user.name", "Acme");
  g(repo.path, "config", "user.email", "dev@example.com");
  g(repo.path, "worktree", "add", "-q", ".worktrees/sum", "-b", "fix/sum");
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

test("closing a task whose worktree holds uncommitted work is asked once to commit it on its branch", async () => {
  const project = (await env.client.call("projects.register", { path: repo.path, init: true })).project.id;
  const task = await env.client.call("tasks.create", {
    title: "Fix the sum, commit late",
    description: "sum(2, 3) must return 5.",
    assignee: "vera",
    project,
  });
  await waitFor(() => env.core.store.tasks.get(task.id)?.state === "done", "closed after committing");
  const seen = env.core.store.threads
    .byTask(task.id)
    .flatMap((t) => env.core.store.runs.list(t.id, 20))
    .flatMap((r) => env.core.store.modelLog.forRun(r.id) as Array<{ role: string; content?: unknown }>)
    .filter((m) => m.role === "tool")
    .map((m) => String(m.content));
  assert.match(seen[1] ?? "", /not closed: uncommitted work in .*sum \(branch fix\/sum\): 1 changed/);
  assert.match(seen[3] ?? "", /now done/);
  assert.match(g(path.join(repo.path, ".worktrees/sum"), "log", "-1", "--format=%s"), /fix: sum adds/);
  assert.match(fs.readFileSync(path.join(repo.path, "sum.js"), "utf8"), /a - b/, "the owner's checkout is untouched");
});
