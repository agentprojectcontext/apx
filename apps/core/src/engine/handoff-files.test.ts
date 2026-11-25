// Files go back with the answer to whoever asked: a delegation's result and a closed task's report name the files the
// work showed, by id, and the asker can show them in its own chat. Words alone carry no file.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const FILES = /Files it showed: (clip\.mp4|final\.mp4) \((med_[0-9a-f]{16})\)\./;
const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const last = String(req.messages.at(-1)?.content);
  const done = req.messages.filter((m) => m.role === "tool").length;
  if (system.startsWith("You are Scout")) {
    if (!afterTool) return callTool("s-send", "send_file", { path: "sources.txt" });
    return say("Sources attached.");
  }
  if (system.startsWith("You are Vera")) {
    const source = /Files it showed: sources\.txt \((med_[0-9a-f]{16})\)\./.exec(said)?.[1];
    if (source && !afterTool) return callTool("v-show-sources", "send_file", { path: source });
    if (JSON.stringify(req.messages).includes("Collect the sources")) {
      if (done === 0) {
        const task = /Task (task_\w+):/.exec(JSON.stringify(req.messages))?.[1] ?? "";
        return callTool("v-ask", "task_comment", { task, text: "@scout Which sources back the claims?" });
      }
      return say("Waiting for Scout.");
    }
    if (said.includes("Render the clip")) {
      if (!afterTool) return callTool("v-send", "send_file", { path: "clip.mp4" });
      return say("Rendered the clip.");
    }
    if (JSON.stringify(req.messages).includes("Deliver the final cut")) {
      if (done === 0) return callTool("v-final", "send_file", { path: "final.mp4" });
      if (done === 1) {
        const task = /Task (task_\w+):/.exec(JSON.stringify(req.messages))?.[1] ?? "";
        return callTool("v-close", "task_close", { task, state: "done", note: "final cut delivered" });
      }
      return say("Final cut delivered.");
    }
    return say("ok");
  }
  // Roby: hands the work on, then shows the file it got back in its own chat.
  if (said.includes("ask vera for the clip") && done === 0)
    return callTool("r-del", "delegate", { agent: "vera", task: "Render the clip." });
  if (said.includes("hand vera the cut") && done === 0)
    return callTool("r-task", "task_create", {
      title: "Final cut",
      goal: "The final cut, delivered",
      description: "Deliver the final cut.",
      assignee: "vera",
    });
  const id = FILES.exec(last)?.[2];
  if (id) return callTool("r-show", "send_file", { path: id });
  return say(afterTool ? "Here it is." : "ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  const work = path.join(env.home, "work");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "clip.mp4"), Buffer.from("clip bytes"));
  fs.writeFileSync(path.join(work, "final.mp4"), Buffer.from("final bytes"));
  fs.writeFileSync(path.join(work, "sources.txt"), "Source list");
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** What the chat shows as files, with their bytes. */
async function shownFiles(thread: string) {
  const { messages } = await env.client.call("threads.get", { thread });
  const parts = messages.flatMap((m) => m.parts).filter((p) => p.type === "file");
  return Promise.all(
    parts.map(async (p) => ({
      name: p.name,
      bytes: Buffer.from((await env.client.call("media.get", { id: p.media_id })).data, "base64").toString(),
    })),
  );
}
const heard = (pattern: RegExp) =>
  llm.calls.some((c) => c.messages.some((m) => m.role !== "assistant" && pattern.test(String(m.content))));

test("a delegation's result names the file it showed, and the asker shows it in its chat", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Clip" });
  await env.client.call("threads.send", { thread: chat.id, text: "ask vera for the clip" });
  await env.settle(chat.id, 10_000);
  assert.ok(heard(/Rendered the clip\.\s+Files it showed: clip\.mp4 \(med_[0-9a-f]{16}\)\./), "the result names it");
  assert.deepEqual(await shownFiles(chat.id), [{ name: "clip.mp4", bytes: "clip bytes" }], "the owner sees it");
});

test("a closed task's report names its files, and its creator shows them where it asked", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Cut" });
  await env.client.call("threads.send", { thread: chat.id, text: "hand vera the cut" });
  const report = /<task_result[^>]*>[\s\S]*Files it showed: final\.mp4 \(med_[0-9a-f]{16}\)\.[\s\S]*<\/task_result>/;
  await waitFor(() => heard(report), "the report naming the file", { ms: 10_000 });
  await env.settle(chat.id, 10_000);
  const files = await shownFiles(chat.id);
  assert.deepEqual(files, [{ name: "final.mp4", bytes: "final bytes" }], "shown once, where it was asked");
});

test("a teammate consulted on a task answers with its file named, for the agent that asked", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Sources",
    description: "Collect the sources.",
    assignee: "vera",
  });
  await waitFor(
    () =>
      heard(
        /Scout answered your question on task task_\w+:\nSources attached\.\n\nFiles it showed: sources\.txt \(med_/,
      ),
    "Vera hearing Scout's file",
    { ms: 10_000 },
  );
  const chat = await waitFor(() => env.core.store.threads.byTask(task.id)[0], "the asker's task chat");
  await waitFor(
    async () => (await shownFiles(chat.id)).length === 1,
    "the asker attaching the consulted teammate's file",
    { ms: 10_000 },
  );
  await env.settle(chat.id, 10_000);
  assert.deepEqual(await shownFiles(chat.id), [{ name: "sources.txt", bytes: "Source list" }]);
  const kept = (await env.client.call("tasks.get", { task: task.id })).attachments;
  assert.equal(kept.length, 1, "only the delivered file is copied onto the task");
  assert.ok(
    heard(new RegExp(`Files it showed: sources\\.txt \\(${kept[0]?.media_id}\\)`)),
    "the answer names the task's readable snapshot",
  );
});
