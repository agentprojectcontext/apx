// A delegated session capped at ask asks before changing files on our own loop too; the owner's own code chat follows
// the agent's mode.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { realpath } from "../paths.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let root = "";
const llm = scriptedLlm((_req, { system, said, afterTool }) => {
  if (system.startsWith("You are Vera") && said.includes("write the note") && !afterTool)
    return callTool("w1", "file_write", { path: "delegated.txt", content: "hello" });
  if (said.includes("own note") && !afterTool) return callTool("w2", "file_write", { path: "own.txt", content: "hi" });
  if (said.includes("ask vera") && !afterTool)
    return callTool("d1", "delegate", {
      agent: "vera",
      task: "write the note",
      project: root,
      write: "auto",
      wait_s: 0,
    });
  return say(afterTool ? "Done." : "ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let project = "";
before(async () => {
  env = await startCore({ llm });
  root = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ask-session-")));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Project\n");
  project = (await env.client.call("projects.register", { path: root, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await new Promise((r) => setTimeout(r, 25));
  return check();
};

test("a delegate from a chat that asks, asks before writing; the owner's own code chat follows the agent's mode", async () => {
  const chat = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    write: "ask",
  });
  await env.client.call("threads.send", { thread: chat.id, text: "write my own note" });
  await env.settle(chat.id);
  assert.equal(fs.readFileSync(path.join(root, "own.txt"), "utf8"), "hi", "Auto writes where it works (D-106)");

  await env.client.call("threads.send", { thread: chat.id, text: "ask vera" });
  await env.settle(chat.id);
  const [session] = env.core.store.threads.sessions(chat.id);
  assert.equal(session?.write, "ask", "auto asked, capped at the chat's ask");
  assert.ok(await until(() => env.core.store.inputs.pending(session?.id ?? "").length === 1), "the owner is asked");
  assert.equal(fs.existsSync(path.join(root, "delegated.txt")), false);
  await env.client.call("runs.respond", {
    input: env.core.store.inputs.pending(session?.id ?? "")[0]?.id ?? "",
    decision: "approve",
  });
  assert.ok(await until(() => fs.existsSync(path.join(root, "delegated.txt"))), "approved: written");
});
