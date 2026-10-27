import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { samePath } from "../paths.ts";

test("batch failure rolls back snapshots and metadata; capped tasks still deduplicate", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Done")) });
  try {
    const file = async (name: string) =>
      (
        await env.client.call("media.upload", {
          name,
          mime: "text/plain",
          data: Buffer.from("Evidence").toString("base64"),
        })
      ).media;
    const first = await file("first.txt");
    const missing = await file("missing.txt");
    const missingRow = env.core.store.media.get(missing.id);
    assert.ok(missingRow);
    fs.unlinkSync(missingRow.path);
    const task = await env.client.call("tasks.create", { title: "Bounded evidence" });
    await assert.rejects(
      env.client.call("tasks.attach", { task: task.id, media_ids: [first.id, missing.id] }),
      /file unavailable/,
    );
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, []);
    const source = env.core.store.media.get(first.id);
    assert.ok(source);
    const dir = path.dirname(missingRow.path);
    assert.ok(fs.readdirSync(dir).every((f) => samePath(source.path, path.join(dir, f))));
    for (let i = 0; i < 50; i++) {
      const source = await file(`evidence-${i}.txt`);
      await env.client.call("tasks.attach", { task: task.id, media_ids: [source.id] });
    }
    assert.equal((await env.client.call("tasks.get", { task: task.id })).attachments.length, 50);
    await assert.rejects(env.client.call("tasks.attach", { task: task.id, media_ids: [first.id] }), /at most 50/);
    const asset = (await env.client.call("tasks.get", { task: task.id })).attachments[0];
    assert.ok(asset);
    await env.client.call("tasks.attach", { task: task.id, media_ids: [asset.media_id] });
    const row = env.core.store.media.get(asset.media_id);
    assert.ok(row);
    await env.client.call("tasks.delete", { task: task.id });
    assert.equal(env.core.store.media.get(asset.media_id), undefined);
    assert.equal(fs.existsSync(row.path), false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
