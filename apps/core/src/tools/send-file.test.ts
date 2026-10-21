import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { mediaTools } from "./media.ts";
import { allowedTools } from "./policy.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  assert.ok(
    req.tools?.some((t) => t.function.name === "send_file"),
    "file tools include chat delivery",
  );
  return callTool("attach", "send_file", { path: said });
});
let env: Awaited<ReturnType<typeof startCore>>;
let base: string;
before(async () => {
  env = await startCore({ llm });
  base = path.join(env.home, "work");
  fs.mkdirSync(base, { recursive: true });
  const agent = env.core.store.agents.get("roby");
  assert.ok(agent);
  assert.ok(
    allowedTools({ ...agent, tools: ["files"] }, mediaTools(env.core.store, env.home)).some(
      (t) => t.name === "send_file",
    ),
  );
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

async function attach(file: string) {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Attachments" });
  await env.client.call("threads.send", { thread: thread.id, text: file });
  const result = await env.settle(thread.id);
  assert.equal(result.runs[0]?.state, "completed");
  return { thread, message: result.messages.at(-1) };
}

test("the agent shares an image and a video larger than composer documents, without putting bytes in model context", async () => {
  const jpg = Buffer.from("ffd8ffe000104a46494600", "hex");
  const video = Buffer.alloc(3 * 1024 * 1024, 1);
  for (const [name, bytes, type, mime] of [
    ["Preview.JPG", jpg, "image", "image/jpeg"],
    ["Render.mp4", video, "file", "video/mp4"],
  ] as const) {
    const file = path.join(base, name);
    fs.writeFileSync(file, bytes);
    const { thread, message } = await attach(name === "Render.mp4" ? file : name);
    const part = message?.parts.find((p) => p.type === type);
    assert.ok(part && (part.type === "image" || part.type === "file") && part.media_id);
    assert.equal(part.mime, mime);
    assert.equal(env.core.store.media.get(part.media_id)?.thread_id, thread.id);
    assert.equal(env.core.store.media.get(part.media_id)?.prompt, name);
    fs.unlinkSync(file);
    const stored = await env.client.call("media.get", { id: part.media_id });
    assert.deepEqual(Buffer.from(stored.data, "base64"), bytes);
    const loaded = await env.client.call("threads.get", { thread: thread.id });
    assert.deepEqual(loaded.messages.at(-1)?.parts, message?.parts);
    assert.ok(String(llm.calls.at(-1)?.messages.at(-1)?.content).length < 500);
  }
});

test("refuses escapes, symlinks, git metadata, missing files, directories, empty files, invalid images and oversized files", async () => {
  fs.writeFileSync(path.join(env.home, "outside.txt"), "Private");
  fs.symlinkSync(path.join(env.home, "outside.txt"), path.join(base, "escape.txt"));
  fs.mkdirSync(path.join(base, ".git"));
  fs.writeFileSync(path.join(base, ".git", "config"), "Private");
  fs.symlinkSync(path.join(base, ".git"), path.join(base, "metadata"));
  fs.writeFileSync(path.join(base, "empty.txt"), "");
  fs.writeFileSync(path.join(base, "invalid.jpg"), "Not an image");
  const huge = fs.openSync(path.join(base, "huge.mp4"), "w");
  fs.ftruncateSync(huge, 20 * 1024 * 1024 + 1);
  fs.closeSync(huge);
  for (const file of [
    "../outside.txt",
    path.join(env.home, "outside.txt"),
    "escape.txt",
    ".git/config",
    "metadata/config",
    "missing.pdf",
    ".",
    "empty.txt",
    "invalid.jpg",
    "huge.mp4",
  ]) {
    const { message } = await attach(file);
    assert.ok(!message?.parts.some((p) => p.type === "file" || p.type === "image"));
    assert.equal(message?.parts.find((p) => p.type === "tool")?.status, "error");
  }
});

test("outside callers cannot read a local file through media.attach", async () => {
  await assert.rejects(env.client.call("media.attach", { path: "outside.txt" }), /only the running agent/);
});

test("the protocol scopes attachments to a live owner run and replays retries without copying twice", async () => {
  const store = env.core.store;
  fs.writeFileSync(path.join(base, "Note.txt"), "Note");
  const thread = store.threads.create({ kind: "loose", title: "Delivery", agent_ids: ["roby"] });
  const queued = store.runs.create({
    thread_id: thread.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Share note" },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const run = store.runs.setState(queued, "working");
  const ctx = {
    transport: "internal" as const,
    role: "operator" as const,
    actor: "agent" as const,
    session: undefined,
    log: createLog("test", true),
    agent: { id: "roby", run_id: run.id, thread_id: thread.id },
  };
  const first = await env.core.dispatch("media.attach", { path: "Note.txt" }, ctx, "file-retry");
  assert.equal(first.ok, true);
  assert.deepEqual(await env.core.dispatch("media.attach", { path: "Note.txt" }, ctx, "file-retry"), first);
  assert.equal(
    (
      await env.core.dispatch(
        "media.attach",
        { path: "Note.txt" },
        { ...ctx, agent: { ...ctx.agent, id: "other" } },
        "wrong-agent",
      )
    ).ok,
    false,
  );
  const contact = store.persons.create({ name: "Contact", role: "contact" });
  const sealed = store.threads.create({
    kind: "loose",
    title: "Contact chat",
    agent_ids: ["roby"],
    channel: { id: "telegram", conversation: "contact", person_id: contact.id },
  });
  assert.equal(
    (
      await env.core.dispatch(
        "media.attach",
        { path: "Note.txt" },
        { ...ctx, agent: { ...ctx.agent, thread_id: sealed.id } },
        "wrong-thread",
      )
    ).ok,
    false,
  );
  const contactRun = store.runs.create({
    thread_id: sealed.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Share note" },
    deadline_at: run.deadline_at ?? "",
  });
  const workingContact = store.runs.setState(contactRun, "working");
  const denied = await env.core.dispatch(
    "media.attach",
    { path: "Note.txt" },
    { ...ctx, agent: { ...ctx.agent, run_id: contactRun.id, thread_id: sealed.id } },
    "sealed-chat",
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error.message, /owner's chats/);
  store.runs.setState(workingContact, "completed");
  store.runs.setState(run, "completed");
  assert.equal((await env.core.dispatch("media.attach", { path: "Note.txt" }, ctx, "ended-run")).ok, false);
});

test("attachments persist after the core restarts and the source disappears", async () => {
  fs.writeFileSync(path.join(base, "Report.pdf"), "%PDF-1.4\nReport");
  const { thread, message } = await attach("Report.pdf");
  const part = message?.parts.find((p) => p.type === "file");
  assert.ok(part);
  fs.unlinkSync(path.join(base, "Report.pdf"));
  await env.core.close();
  env = await startCore({ llm, home: env.home });
  const loaded = await env.client.call("threads.get", { thread: thread.id });
  assert.deepEqual(loaded.messages.at(-1)?.parts, message?.parts);
  const stored = await env.client.call("media.get", { id: part.media_id });
  assert.equal(Buffer.from(stored.data, "base64").toString(), "%PDF-1.4\nReport");
});
