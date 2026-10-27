import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { pruneTaskUploads, pruneUploads, saveUpload } from "../services/uploads.ts";

test("temporary task uploads are consumed or discarded without deleting unrelated media", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  try {
    const pending = async () =>
      (
        await env.client.call("media.upload", {
          name: "proof.txt",
          mime: "text/plain",
          data: Buffer.from("Evidence").toString("base64"),
          task_asset: true,
        })
      ).media;
    const source = await pending();
    const row = env.core.store.media.get(source.id);
    assert.ok(row);
    const task = await env.client.call("tasks.create", { title: "Consume upload", attachments: [source.id] });
    const asset = (await env.client.call("tasks.get", { task: task.id })).attachments[0];
    assert.ok(asset);
    assert.equal(env.core.store.media.get(source.id), undefined);
    assert.equal(fs.existsSync(row.path), false);
    await env.client.call("media.discard", { id: asset.media_id });
    assert.ok(env.core.store.media.get(asset.media_id));
    const canceled = await pending();
    const canceledRow = env.core.store.media.get(canceled.id);
    assert.ok(canceledRow);
    await assert.rejects(
      env.client.call("threads.send", { thread: "home", text: "Not a chat upload", attachments: [canceled.id] }),
      /no attachment/,
    );
    await env.client.call("media.discard", { id: canceled.id });
    assert.equal(env.core.store.media.get(canceled.id), undefined);
    assert.equal(fs.existsSync(canceledRow.path), false);
    const failed = await pending();
    await assert.rejects(
      env.client.call("tasks.create", { title: "Failure", attachments: [failed.id, "med_missing"] }),
      /media unavailable/,
    );
    assert.ok(env.core.store.taskAttachments.pending(failed.id));
    await env.client.call("media.discard", { id: failed.id });
    assert.equal(env.core.store.media.get(failed.id), undefined);
    const abandoned = await pending();
    const abandonedRow = env.core.store.media.get(abandoned.id);
    assert.ok(abandonedRow);
    pruneTaskUploads(env.core.store, new Date(Date.parse(abandonedRow.created_at) + 25 * 60 * 60 * 1000));
    assert.equal(env.core.store.media.get(abandoned.id), undefined);
    assert.equal(fs.existsSync(abandonedRow.path), false);
    assert.ok(env.core.store.media.get(asset.media_id));
    const external = new ApxClient({ url: env.core.url, actor: "agent" });
    assert.deepEqual((await external.call("tasks.get", { task: task.id })).attachments, []);
    await assert.rejects(
      external.call("tasks.attach", { task: task.id, media_ids: [asset.media_id] }),
      /live owner chat/,
    );
    await assert.rejects(external.call("media.get", { id: asset.media_id }), /live owner chat/);
    const sealed = env.core.store.threads.create({ kind: "loose", title: "Client", agent_ids: ["roby"] });
    env.core.store.threads.mergeContext(sealed.id, { client: "external" });
    const run = env.core.store.runs.create({
      thread_id: sealed.id,
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Read" },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    env.core.store.runs.setState(run, "working");
    const ctx = {
      transport: "internal" as const,
      role: "operator" as const,
      actor: "agent" as const,
      session: undefined,
      log: createLog("test", true),
      agent: { id: "roby", thread_id: sealed.id, run_id: run.id },
    };
    const detail = await env.core.dispatch("tasks.get", { task: task.id }, ctx);
    assert.ok(detail.ok);
    if (detail.ok) {
      assert.ok(detail.result && typeof detail.result === "object" && "attachments" in detail.result);
      assert.deepEqual(detail.result.attachments, []);
    }
    assert.equal(
      (await env.core.dispatch("tasks.attach", { task: task.id, media_ids: [asset.media_id] }, ctx, "sealed")).ok,
      false,
    );
    env.core.store.runs.setState(run, "completed");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("browser upload pruning cannot retire a task-owned snapshot", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  try {
    const source = saveUpload(env.home, env.core.store, {
      name: "browser-snapshot.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("ffd8ff01", "hex"),
    });
    const task = await env.client.call("tasks.create", { title: "Keep browser evidence", attachments: [source.id] });
    const asset = (await env.client.call("tasks.get", { task: task.id })).attachments[0];
    assert.ok(asset);
    const stored = env.core.store.media.get(asset.media_id);
    assert.ok(stored);
    for (let i = 0; i < 5; i++)
      saveUpload(env.home, env.core.store, {
        name: "browser-snapshot.jpg",
        mime: "image/jpeg",
        bytes: Buffer.from("ffd8ff01", "hex"),
        thread: task.thread_id,
      });
    pruneUploads(env.core.store, task.thread_id, "browser-snapshot.jpg", 4);
    assert.ok(env.core.store.media.get(asset.media_id));
    assert.equal(fs.existsSync(stored.path), true);
    assert.equal(env.core.store.media.named(task.thread_id, "browser-snapshot.jpg").length, 5);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a failed detach unlink remains tracked until a later cleanup retries it", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  try {
    const source = saveUpload(env.home, env.core.store, {
      name: "proof.txt",
      mime: "text/plain",
      bytes: Buffer.from("Evidence"),
    });
    const task = await env.client.call("tasks.create", { title: "Remove evidence", attachments: [source.id] });
    const asset = (await env.client.call("tasks.get", { task: task.id })).attachments[0];
    assert.ok(asset);
    const stored = env.core.store.media.get(asset.media_id);
    assert.ok(stored);
    const unlink = t.mock.method(fs, "rmSync", () => {
      throw new Error("injected unlink failure");
    });
    await env.client.call("tasks.detach", { task: task.id, media_id: asset.media_id });
    unlink.mock.restore();
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, []);
    assert.ok(env.core.store.taskAttachments.pending(asset.media_id));
    assert.equal(fs.existsSync(stored.path), true);
    const run = env.core.store.runs.create({
      thread_id: task.thread_id,
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Read detached evidence" },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    env.core.store.runs.setState(run, "working");
    const ctx = {
      transport: "internal" as const,
      role: "operator" as const,
      actor: "agent" as const,
      session: undefined,
      log: createLog("test", true),
      agent: { id: "roby", thread_id: task.thread_id, run_id: run.id },
    };
    try {
      assert.equal((await env.core.dispatch("media.get", { id: asset.media_id }, ctx)).ok, false);
      assert.equal(
        (await env.core.dispatch("media.attach", { path: asset.media_id }, ctx, "detached-materialize")).ok,
        false,
      );
      assert.equal(
        (
          await env.core.dispatch(
            "tasks.attach",
            { task: task.id, media_ids: [asset.media_id] },
            ctx,
            "detached-reattach",
          )
        ).ok,
        false,
      );
      assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, []);
    } finally {
      env.core.store.runs.setState(run, "completed");
    }
    pruneTaskUploads(env.core.store, new Date(Date.parse(stored.created_at) + 25 * 60 * 60 * 1000));
    assert.equal(env.core.store.media.get(asset.media_id), undefined);
    assert.equal(fs.existsSync(stored.path), false);
    assert.ok(env.core.store.media.get(source.id));
  } finally {
    t.mock.restoreAll();
    await env.core.close();
    await env.cleanup();
  }
});

test("failed media insertion cleans up the file that saveUpload just wrote", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  try {
    t.mock.method(env.core.store.media, "add", () => {
      throw new Error("injected insert failure");
    });
    assert.throws(
      () =>
        saveUpload(env.home, env.core.store, { name: "proof.txt", mime: "text/plain", bytes: Buffer.from("Evidence") }),
      /injected insert failure/,
    );
    const root = path.join(env.home, "media", "uploads");
    assert.ok(fs.readdirSync(root).every((day) => fs.readdirSync(path.join(root, day)).length === 0));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
