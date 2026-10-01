import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 200)}`);
  if (said.includes("make a file")) return callTool("m1", "shell", { command: "touch made.txt" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-code-")));
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
  assert.match(lastSeen(), /read-only/);
  assert.ok(!fs.existsSync(path.join(repo, "made.txt")));
});

test("after an approved change, the turn ends with what git sees as uncommitted", async () => {
  const t = await env.client.call("threads.create", { kind: "code", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "make a file" });
  let input = "";
  for (let i = 0; i < 200 && !input; i++) {
    input = (await env.client.call("runs.pending", { thread: t.id })).inputs[0]?.id ?? "";
    await new Promise((r) => setTimeout(r, 20));
  }
  await env.client.call("runs.respond", { input, decision: "approve" });
  const { messages } = await env.settle(t.id);
  const changes = messages.at(-1)?.parts.find((p) => p.type === "changes");
  assert.ok(changes?.type === "changes");
  assert.deepEqual(changes.files, [{ path: "made.txt", status: "??" }]);
});
