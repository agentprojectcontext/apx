import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("HTTP and WebSocket use the same durable task attachments contract", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  const socket = await new ApxClient({ url: env.core.url }).connect();
  try {
    const upload = await env.client.call("media.upload", {
      name: "evidence.txt",
      mime: "text/plain",
      data: Buffer.from("Verified").toString("base64"),
    });
    const task = await socket.call("tasks.create", { title: "Transport evidence", attachments: [upload.media.id] });
    const http = await env.client.call("tasks.get", { task: task.id });
    const ws = await socket.call("tasks.get", { task: task.id });
    assert.deepEqual(ws.attachments, http.attachments);
    assert.equal(ws.attachments.length, 1);
    const first = await socket.call("tasks.attach", { task: task.id, media_ids: [upload.media.id] }, "attach-retry");
    assert.deepEqual(
      await socket.call("tasks.attach", { task: task.id, media_ids: [upload.media.id] }, "attach-retry"),
      first,
    );
    const asset = ws.attachments[0];
    assert.ok(asset);
    assert.deepEqual(
      await socket.call("media.get", { id: asset.media_id }),
      await env.client.call("media.get", { id: asset.media_id }),
    );
    await socket.call("tasks.detach", { task: task.id, media_id: asset.media_id });
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, []);
  } finally {
    socket.close();
    await env.core.close();
    await env.cleanup();
  }
});
