import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";

const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const upload = (name = "screen.png") => ({ name, mime: "image/png", data: png.toString("base64") });

test("selected task snapshots survive source chat deletion, pagination and restart; retries deduplicate", async () => {
  let env = await startCore({ llm: scriptedLlm(() => say("Done")) });
  try {
    const source = await env.client.call("threads.create", { kind: "loose", title: "Evidence chat", agent_id: "roby" });
    const { media } = await env.client.call("media.upload", { ...upload(), thread: source.id });
    const task = await env.client.call("tasks.create", {
      title: "Review screenshot",
      attachments: [media.id, media.id],
    });
    const detail = await env.client.call("tasks.get", { task: task.id });
    assert.equal(detail.attachments.length, 1);
    const asset = detail.attachments[0];
    assert.ok(asset);
    assert.notEqual(asset.media_id, media.id);
    assert.deepEqual(await env.client.call("tasks.attach", { task: task.id, media_ids: [media.id] }), {
      attachments: [asset],
    });
    assert.deepEqual(await env.client.call("tasks.attach", { task: task.id, media_ids: [asset.media_id] }), {
      attachments: [asset],
    });
    for (let i = 0; i < 65; i++)
      env.core.store.messages.add({
        thread_id: task.thread_id,
        author: { kind: "user" },
        parts: [{ type: "text", text: `Comment ${i}` }],
      });
    await env.client.call("threads.delete", { thread: source.id });
    assert.equal(env.core.store.media.get(media.id), undefined);
    assert.equal((await env.client.call("tasks.get", { task: task.id })).attachments.length, 1);
    const home = env.home;
    await env.core.close();
    env = await startCore({ home, llm: scriptedLlm(() => say("Done")) });
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, [asset]);
    assert.equal((await env.client.call("media.get", { id: asset.media_id })).data, png.toString("base64"));
    const path = env.core.store.media.get(asset.media_id)?.path;
    assert.ok(path);
    await env.client.call("tasks.detach", { task: task.id, media_id: asset.media_id });
    assert.equal(fs.existsSync(path), false);
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the total attachment limit rejects overflow atomically but permits retries and snapshot deduplication", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Done")) });
  try {
    const sources: string[] = [];
    for (let i = 0; i < 51; i++) sources.push((await env.client.call("media.upload", upload())).media.id);
    const task = await env.client.call("tasks.create", {
      title: "Bounded evidence",
      attachments: sources.slice(0, 20),
    });
    await env.client.call("tasks.attach", { task: task.id, media_ids: sources.slice(20, 40) });
    await env.client.call("tasks.attach", { task: task.id, media_ids: sources.slice(40, 49) });
    const before = (await env.client.call("tasks.get", { task: task.id })).attachments;
    assert.equal(before.length, 49);
    await assert.rejects(
      env.client.call("tasks.attach", { task: task.id, media_ids: sources.slice(49) }),
      /at most 50 attachments/,
    );
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, before);
    const full = await env.client.call("tasks.attach", { task: task.id, media_ids: [sources[49] as string] });
    assert.equal(full.attachments.length, 50);
    const snapshot = full.attachments[49];
    assert.ok(snapshot);
    assert.deepEqual(
      await env.client.call("tasks.attach", { task: task.id, media_ids: [sources[49] as string, snapshot.media_id] }),
      full,
    );
    await assert.rejects(
      env.client.call("tasks.attach", { task: task.id, media_ids: [sources[50] as string] }),
      /at most 50 attachments/,
    );
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, full.attachments);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("missing or oversized sources leave no partial task or attachment metadata", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Done")) });
  try {
    const { media } = await env.client.call("media.upload", upload());
    const task = await env.client.call("tasks.create", { title: "Existing task" });
    await assert.rejects(
      env.client.call("tasks.create", { title: "Invalid source", attachments: [media.id, "med_missing"] }),
      /media unavailable/,
    );
    assert.equal((await env.client.call("tasks.list", {})).tasks.length, 1);
    const missing = env.core.store.media.get(media.id);
    assert.ok(missing);
    fs.unlinkSync(missing.path);
    await assert.rejects(env.client.call("tasks.attach", { task: task.id, media_ids: [media.id] }), /file unavailable/);
    assert.deepEqual((await env.client.call("tasks.get", { task: task.id })).attachments, []);
    const big = env.core.store.media.add({
      kind: "file",
      mime: "application/octet-stream",
      bytes: 21 * 1024 * 1024,
      path: missing.path,
    });
    await assert.rejects(env.client.call("tasks.attach", { task: task.id, media_ids: [big.id] }), /20 MB/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("live agents reuse readable media but cannot export contact, client or foreign-project assets", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Done")) });
  const { store } = env.core;
  const runs: ReturnType<typeof store.runs.create>[] = [];
  try {
    store.projects.upsert({ id: "acme", name: "Acme" });
    store.projects.upsert({ id: "northwind", name: "Northwind" });
    store.agents.upsert({
      id: "editor",
      name: "Editor",
      project_id: "acme",
      kind: "agent",
      role: "Editor",
      browser_profile: "incognito",
    });
    const source = store.threads.create({
      kind: "loose",
      title: "Evidence chat",
      agent_ids: ["editor"],
      project_id: "acme",
    });
    const target = store.threads.create({
      kind: "loose",
      title: "Evidence chat",
      agent_ids: ["editor"],
      project_id: "acme",
    });
    const { media } = await env.client.call("media.upload", { ...upload(), thread: source.id });
    const context = (id: string, thread: string) => {
      const run = store.runs.create({
        thread_id: thread,
        agent_id: id,
        trigger: "user",
        input: { origin: { kind: "user" }, text: "Inspect" },
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
      });
      runs.push(run);
      store.runs.setState(run, "working");
      return {
        transport: "internal" as const,
        role: "operator" as const,
        actor: "agent" as const,
        session: undefined,
        log: createLog("test", true),
        agent: { id, thread_id: thread, run_id: run.id },
      };
    };
    const ctx = context("editor", target.id);
    const allowed = await env.core.dispatch("media.attach", { path: media.id }, ctx, "readable");
    assert.equal(allowed.ok, true);
    assert.equal((await env.core.dispatch("media.get", { id: media.id }, ctx)).ok, true);
    const task = await env.client.call("tasks.create", { title: "Project evidence", project: "acme" });
    assert.equal(
      (await env.core.dispatch("tasks.attach", { task: task.id, media_ids: [media.id] }, ctx, "task-readable")).ok,
      true,
    );
    const foreign = store.threads.create({
      kind: "loose",
      title: "Evidence chat",
      project_id: "northwind",
      agent_ids: ["roby"],
    });
    const contact = store.persons.create({ name: "Contact", role: "contact" });
    const sealed = store.threads.create({
      kind: "loose",
      title: "Evidence chat",
      agent_ids: ["roby"],
      channel: { id: "telegram", conversation: "contact", person_id: contact.id },
    });
    const client = store.threads.create({ kind: "loose", title: "Evidence chat", agent_ids: ["roby"] });
    store.threads.mergeContext(client.id, { client: "outside" });
    const robyChat = store.threads.create({ kind: "loose", title: "Evidence chat", agent_ids: ["roby"] });
    const superCtx = context("roby", robyChat.id);
    for (const thread of [foreign, sealed, client]) {
      const m = (await env.client.call("media.upload", { ...upload(), thread: thread.id })).media;
      for (const caller of thread === foreign ? [ctx] : [ctx, superCtx]) {
        assert.equal((await env.core.dispatch("media.get", { id: m.id }, caller)).ok, false);
        assert.equal(
          (await env.core.dispatch("media.attach", { path: m.id }, caller, `deny-${thread.id}-${caller.agent.id}`)).ok,
          false,
        );
        assert.equal(
          (
            await env.core.dispatch(
              "tasks.attach",
              { task: task.id, media_ids: [m.id] },
              caller,
              `task-deny-${thread.id}-${caller.agent.id}`,
            )
          ).ok,
          false,
        );
      }
    }
    const foreignTask = await env.client.call("tasks.create", {
      title: "Foreign evidence",
      project: "northwind",
      attachments: [media.id],
    });
    const foreignAsset = (await env.client.call("tasks.get", { task: foreignTask.id })).attachments[0];
    assert.ok(foreignAsset);
    assert.equal(
      (await env.core.dispatch("media.attach", { path: foreignAsset.media_id }, ctx, "foreign-task")).ok,
      false,
    );
    assert.equal((await env.core.dispatch("media.attach", { path: media.id }, superCtx, "super-readable")).ok, true);
    const ended = store.runs.get(ctx.agent.run_id);
    assert.ok(ended);
    store.runs.setState(ended, "completed");
    assert.equal(
      (await env.core.dispatch("tasks.attach", { task: task.id, media_ids: [media.id] }, ctx, "ended")).ok,
      false,
    );
  } finally {
    for (const run of runs) store.runs.setState(run, "completed");
    await env.core.close();
    await env.cleanup();
  }
});

test("task tools preserve the selected screenshot and later inspect it without opening another scratch folder", async () => {
  let selected = "";
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    if (said === "create with screen")
      return callTool("create", "task_create", { title: "Inspect screenshot", attachments: [selected] });
    if (said.startsWith("read:")) return callTool("read", "file_read", { path: said.slice(5) });
    if (said.startsWith("chat:")) return callTool("chat", "read_chat", { chat: said.slice(5) });
    return say("Done");
  });
  const env = await startCore({ llm });
  try {
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    const source = await env.client.call("threads.create", { kind: "loose", title: "Evidence chat", agent_id: "roby" });
    selected = (await env.client.call("media.upload", { ...upload(), thread: source.id })).media.id;
    env.core.store.messages.add({
      thread_id: source.id,
      author: { kind: "user" },
      parts: [{ type: "image", media_id: selected, mime: "image/png", alt: "Selected screenshot" }],
    });
    await env.client.call("threads.send", { thread: source.id, text: "create with screen" });
    await env.settle(source.id);
    const task = (await env.client.call("tasks.list", {})).tasks[0];
    assert.ok(task);
    const asset = (await env.client.call("tasks.get", { task: task.id })).attachments[0];
    assert.ok(asset);
    const session = env.core.store.threads.create({
      kind: "loose",
      title: "Evidence chat",
      agent_ids: ["roby"],
      task_id: task.id,
    });
    await env.client.call("threads.send", { thread: session.id, text: `read:${asset.media_id}` });
    await env.settle(session.id);
    const vision = llm.calls.at(-1);
    assert.ok(vision?.messages.some((m) => m.role === "user" && m.images?.some((i) => i.mime === "image/png")));
    assert.ok(vision?.messages.some((m) => m.role === "tool" && String(m.content).includes("an image")));
    await env.client.call("threads.send", { thread: session.id, text: `chat:${source.id}` });
    const read = await env.settle(session.id);
    assert.match(read.messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "", new RegExp(selected));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
