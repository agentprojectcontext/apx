// One answer per agent and call, wherever the question is asked: a tool, a method a tool calls (media.attach), or an
// outside agent's own tool. Each case here was once refused by one path while the executor allowed it
// (DECISIONS.md#d-115).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { PendingInput } from "@apx/protocol";
import { realpath } from "../paths.ts";
import { scratchDir } from "../tools/folders.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// The owner's message is the call to make: `{"name": "send_file", "args": {...}}`.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (!said.startsWith("{")) return say("ok");
  const { name, args } = JSON.parse(said) as { name: string; args: object };
  return callTool("c1", name, args);
});
// The smallest PNG there is (1×1).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let env: Awaited<ReturnType<typeof startCore>>;
/** Another of the owner's folders, with a video and a picture in it, as a reel in another project. */
let elsewhere: string;
let video: string;
let picture: string;
let project: string;
before(async () => {
  env = await startCore({ llm });
  elsewhere = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-reels-")));
  video = path.join(elsewhere, "reel-es.mp4");
  picture = path.join(elsewhere, "cover.png");
  fs.writeFileSync(video, Buffer.from("not really a video"));
  fs.writeFileSync(picture, Buffer.from(PNG, "base64"));
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-acme-")));
  project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  await env.client.call("agents.create", { slug: "clerk", name: "Clerk" });
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

const lastSeen = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

/** One call in a chat with Clerk in `mode`; answers the card it raises, if any, with `decision`. */
async function run(
  mode: "manual" | "auto" | "total",
  call: { name: string; args: object },
  o: { inProject?: boolean; decision?: "approve" | "deny"; thread?: string } = {},
) {
  await env.client.call("agents.update", { agent: "clerk", autonomy: mode });
  const thread =
    o.thread ??
    (
      await env.client.call("threads.create", {
        kind: "loose",
        agent_id: "clerk",
        ...(o.inProject ? { project_id: project } : {}),
      })
    ).id;
  await env.client.call("threads.send", { thread, text: JSON.stringify(call) });
  let input: PendingInput | undefined;
  for (let i = 0; i < 60 && !input; i++) {
    input = (await env.client.call("runs.pending", { thread })).inputs[0];
    const busy = (await env.client.call("threads.get", { thread })).runs.some((r) => !r.ended_at);
    if (!input && !busy && i > 2) break;
    if (!input) await new Promise((r) => setTimeout(r, 25));
  }
  if (input && o.decision) await env.client.call("runs.respond", { input: input.id, decision: o.decision });
  await env.settle(thread);
  return { thread, input, said: lastSeen() };
}

test("total sends the owner a video from another folder in a chat with no project, with no card", async () => {
  const r = await run("total", { name: "send_file", args: { path: video } });
  assert.equal(r.input, undefined);
  assert.match(r.said, /Attached reel-es\.mp4/);
});

test("auto sends a file and reads a picture from another folder, as the executor already let it", async () => {
  const sent = await run("auto", { name: "send_file", args: { path: video } });
  assert.equal(sent.input, undefined);
  assert.match(sent.said, /Attached reel-es\.mp4/);
  // file_read let the path through, then media.attach refused it on the chat as the store keeps it.
  await run("auto", { name: "file_read", args: { path: picture } });
  const result = llm.calls.at(-1)?.messages.find((m) => m.role === "tool" && String(m.content).includes("cover.png"));
  assert.match(String(result?.content), /an image \(image\/png/);
  const doc = path.join(elsewhere, "plan.md");
  fs.writeFileSync(doc, "# Plan\n");
  const opened = await run("auto", { name: "open_document", args: { path: doc } });
  assert.match(opened.said, /Document plan\.md .* opened/);
});

test("manual asks with a folder card before sending a file from outside, and the folder it lent reaches the attach", async () => {
  for (const inProject of [true, false]) {
    const r = await run("manual", { name: "send_file", args: { path: video } }, { inProject, decision: "approve" });
    assert.deepEqual(r.input?.folders, [elsewhere], `in a project: ${inProject}`);
    assert.match(r.said, /Attached reel-es\.mp4/, `in a project: ${inProject}`);
  }
});

test("the owner gets any file the agent may read through a channel message; anyone else, only its work folder's", async () => {
  const toOwner = await run("total", { name: "message_contact", args: { to: "me", text: "the reel", files: [video] } });
  assert.doesNotMatch(toOwner.said, /not sent/);
  const repo = env.core.store.projects.get(project)?.path ?? "";
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "config"), "[remote]\n");
  const git = await run(
    "total",
    { name: "message_contact", args: { to: "me", text: "config", files: [".git/config"] } },
    { inProject: true },
  );
  assert.match(git.said, /not sent: the \.git folder is off limits/);
});

test("temp files never ask, even in manual: a file written there or a command run there", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "clerk", project_id: project }))
    .id;
  const temp = scratchDir(env.core.store, env.home, { id: thread });
  fs.mkdirSync(temp, { recursive: true });
  const write = await run(
    "manual",
    { name: "file_write", args: { path: path.join(temp, "notes.txt"), content: "draft\n" } },
    { thread },
  );
  assert.equal(write.input, undefined);
  assert.equal(fs.readFileSync(path.join(temp, "notes.txt"), "utf8"), "draft\n");
  const shell = await run(
    "manual",
    { name: "shell", args: { command: "echo hi > out.txt && cat out.txt", cwd: temp } },
    { thread },
  );
  assert.equal(shell.input, undefined);
  assert.match(shell.said, /exit 0[\s\S]*hi/);
  // A command that writes outside the temp folder is not temp work: manual still asks.
  const out = await run(
    "manual",
    { name: "shell", args: { command: `echo hi > ${path.join(elsewhere, "x.txt")}`, cwd: temp } },
    { thread, decision: "deny" },
  );
  assert.ok(out.input, "a card");
});

test("delegating with a project's id finds the project and never reads the id as a folder", async () => {
  // As the owner's core runs from inside the APX project: the id once resolved against it as a sub-folder.
  const was = process.cwd();
  process.chdir(env.core.store.projects.get(project)?.path ?? was);
  try {
    const r = await run(
      "total",
      { name: "delegate", args: { agent: "roby", project, task: "say hi", wait_s: 0 } },
      { inProject: false },
    );
    assert.doesNotMatch(r.said, /no folder|refused/);
  } finally {
    process.chdir(was);
  }
});
