// What an agent hands the owner for review shows on the task's conversation, next to its words: not only in the
// task's attachments or in the agent's own chat for the task. A retried turn shows nothing twice; a new version under
// the same name says so.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { versioned } from "../rpc/task-assets.ts";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let taskId = "";
const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const done = req.messages.filter((m) => m.role === "tool").length;
  const last = String(req.messages.at(-1)?.content);
  if (!system.startsWith("You are Vera")) return say("ok");
  if (said.includes("Show the cut")) {
    if (!afterTool) return callTool(`send${done}`, "send_file", { path: "cut.mp4" });
    return say("@owner Does the voice sound right in this cut?");
  }
  if (said.includes("Ask with the file")) {
    if (!afterTool)
      return callTool("wait", "task_update", {
        task: taskId,
        attachments: ["poster.png"],
        awaits_owner: true,
        why: "Approve the poster before it is scheduled.",
      });
    return say(last);
  }
  if (said.includes("Comment too big")) {
    if (!afterTool)
      return callTool("big", "task_comment", {
        task: taskId,
        text: "@owner Is the raw footage usable?",
        attachments: ["raw.mp4"],
      });
    return say(last);
  }
  if (said.includes("Comment with files")) {
    if (!afterTool)
      return callTool("comment", "task_comment", {
        task: taskId,
        text: "@owner Is this final copy right?",
        attachments: ["copy.txt"],
      });
    return say(last);
  }
  return say("Working on it.");
});

let env: Awaited<ReturnType<typeof startCore>>;
let work = "";
before(async () => {
  env = await startCore({ llm });
  work = path.join(env.home, "work");
  fs.mkdirSync(work, { recursive: true });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const files = (m: Message | undefined) => (m?.parts ?? []).filter((p) => p.type === "file" || p.type === "image");
const agentComments = async (thread: string) =>
  (await env.client.call("threads.get", { thread })).messages.filter((m) => m.author.kind === "agent");
/** The task, with Vera's chat for it settled after its first turn. */
async function taskForVera(title: string) {
  const task = await env.client.call("tasks.create", { title, description: `Deliver the ${title}.`, assignee: "vera" });
  taskId = task.id;
  const chat = await waitFor(() => env.core.store.threads.byTask(task.id)[0], "Vera's chat for the task");
  await env.settle(chat.id);
  return { task, chat };
}
async function turn(chat: string, text: string) {
  await env.client.call("threads.send", { thread: chat, text });
  return env.settle(chat);
}

test("a file shown in the agent's chat goes with its question to the owner on the task, once", async () => {
  fs.writeFileSync(path.join(work, "cut.mp4"), Buffer.from("first render"));
  const { task, chat } = await taskForVera("Spanish reel");
  await turn(chat.id, "Show the cut for review.");

  const asked = (await agentComments(task.thread_id)).at(-1);
  assert.match(JSON.stringify(asked?.parts), /Does the voice sound right/);
  const [shown] = files(asked);
  assert.ok(shown && shown.type === "file", "the cut shows with the question");
  assert.equal(shown.name, "cut.mp4");
  assert.equal(shown.mime, "video/mp4");
  const kept = (await env.client.call("tasks.get", { task: task.id })).attachments;
  assert.deepEqual(
    kept.map((a) => a.media_id),
    [shown.media_id],
    "the same file is kept with the task",
  );
  const bytes = await env.client.call("media.get", { id: shown.media_id });
  assert.equal(Buffer.from(bytes.data, "base64").toString(), "first render");

  // Asked again with the same file: the question is posted, the file is neither copied nor shown again.
  await turn(chat.id, "Show the cut for review again.");
  const again = (await agentComments(task.thread_id)).at(-1);
  assert.notEqual(again?.id, asked?.id);
  assert.deepEqual(files(again), []);
  assert.equal((await env.client.call("tasks.get", { task: task.id })).attachments.length, 1);

  // A new render under the same name is a new version, shown as such.
  fs.writeFileSync(path.join(work, "cut.mp4"), Buffer.from("second render, new voice"));
  await turn(chat.id, "Show the cut for review, new voice.");
  const [v2] = files((await agentComments(task.thread_id)).at(-1));
  assert.ok(v2 && v2.type === "file");
  assert.equal(v2.name, "cut (v2).mp4");
  assert.equal((await env.client.call("tasks.get", { task: task.id })).attachments.length, 2);
});

test("waiting on the owner shows the files it is about with what they must decide", async () => {
  fs.writeFileSync(path.join(work, "poster.png"), Buffer.from("89504e470d0a1a0a0000", "hex"));
  const { task, chat } = await taskForVera("Poster");
  await turn(chat.id, "Ask with the file.");
  const why = (await agentComments(task.thread_id)).find((m) => JSON.stringify(m.parts).includes("Approve the poster"));
  const [poster] = files(why);
  assert.ok(poster && poster.type === "image");
  const detail = await env.client.call("tasks.get", { task: task.id });
  assert.equal(detail.task.awaits_owner, true);
  assert.deepEqual(
    detail.attachments.map((a) => a.media_id),
    [poster.media_id],
    "kept once, the one shown",
  );
});

test("a comment carries the files it names; one over 20 MB is refused and nothing is posted", async () => {
  fs.writeFileSync(path.join(work, "copy.txt"), "Final caption, version 3.");
  const { task, chat } = await taskForVera("Captions");
  const done = await turn(chat.id, "Comment with files.");
  assert.match(JSON.stringify(done.messages.at(-1)?.parts), /1 file\(s\) shown with it/);
  const [copy] = files(
    (await agentComments(task.thread_id)).find((m) => JSON.stringify(m.parts).includes("final copy")),
  );
  assert.ok(copy && copy.type === "file");
  assert.equal(copy.name, "copy.txt");

  fs.writeFileSync(path.join(work, "raw.mp4"), Buffer.alloc(21 * 1024 * 1024, 1));
  const before = (await agentComments(task.thread_id)).length;
  const big = await turn(chat.id, "Comment too big.");
  assert.match(JSON.stringify(big.messages.at(-1)?.parts), /20 MB/);
  assert.equal((await agentComments(task.thread_id)).length, before);
});

test("a file's next version is named after it", () => {
  assert.equal(versioned("cut.mp4", []), "cut.mp4");
  assert.equal(versioned("cut.mp4", ["cut.mp4"]), "cut (v2).mp4");
  assert.equal(versioned("cut.mp4", ["cut.mp4", "cut (v2).mp4", "poster.png"]), "cut (v3).mp4");
  assert.equal(versioned("notes", ["notes"]), "notes (v2)");
});
