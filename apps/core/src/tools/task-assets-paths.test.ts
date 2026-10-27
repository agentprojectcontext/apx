import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("task_update snapshots a readable file and a later session reads and shares it by durable id", async () => {
  let taskId = "";
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    if (said === "add file") return callTool("attach", "task_update", { task: taskId, attachments: ["proof.txt"] });
    return callTool("read", said.startsWith("share:") ? "send_file" : "file_read", {
      path: said.slice(said.indexOf(":") + 1),
    });
  });
  const env = await startCore({ llm });
  try {
    const work = path.join(env.home, "work");
    fs.mkdirSync(work, { recursive: true });
    const original = path.join(work, "proof.txt");
    fs.writeFileSync(original, "Evidence kept with the task");
    const task = await env.client.call("tasks.create", { title: "File evidence" });
    taskId = task.id;
    const source = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: source.id, text: "add file" });
    await env.settle(source.id);
    const asset = (await env.client.call("tasks.get", { task: task.id })).attachments[0];
    assert.ok(asset);
    assert.equal(asset.name, "proof.txt");
    fs.unlinkSync(original);
    await env.client.call("threads.delete", { thread: source.id });
    const target = env.core.store.threads.create({
      kind: "loose",
      title: "Task session",
      agent_ids: ["roby"],
      task_id: task.id,
    });
    await env.client.call("threads.send", { thread: target.id, text: `read:${asset.media_id}` });
    const inspected = await env.settle(target.id);
    assert.match(
      inspected.messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "",
      /Evidence kept with the task/,
    );
    await env.client.call("threads.send", { thread: target.id, text: `share:${asset.media_id}` });
    const shared = await env.settle(target.id);
    const part = shared.messages.at(-1)?.parts.find((p) => p.type === "file");
    assert.ok(part);
    assert.notEqual(part.media_id, asset.media_id);
    assert.equal(
      Buffer.from((await env.client.call("media.get", { id: part.media_id })).data, "base64").toString(),
      "Evidence kept with the task",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
