// Media of the owner's other chats, task chats in other projects included, is usable by the owner's agents; a
// contact's attachments and an outside app's turn stay sealed (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { saveUpload } from "../services/uploads.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let builder = "";
let acme = "";
let northwind = "";
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  acme = (await env.client.call("projects.create", { name: "Acme" })).project.id;
  northwind = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
  builder = (await env.client.call("agents.create", { project_id: acme, slug: "builder", name: "Builder" })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** A chat of the builder's with a live turn, as its tool calls reach the core. */
function caller(context?: Record<string, unknown>) {
  const store = env.core.store;
  const t = store.threads.create({ kind: "loose", title: "Acme work", agent_ids: [builder], project_id: acme });
  if (context) store.threads.mergeContext(t.id, context);
  const run = store.runs.create({
    thread_id: t.id,
    agent_id: builder,
    trigger: "user",
    input: { text: "Look", origin: { kind: "user" } },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.runs.setState(run, "working");
  return {
    thread: t.id,
    ctx: {
      role: "operator" as const,
      actor: "agent" as const,
      transport: "internal" as const,
      session: undefined,
      log: createLog("test", true),
      agent: { id: builder, thread_id: t.id, run_id: run.id },
    },
  };
}

const upload = (thread: string, name: string, mime: string) =>
  saveUpload(env.home, env.core.store, { name, mime, bytes: Buffer.from("OggS-fake-audio"), thread }).id;

const message = (r: { ok: boolean; error?: { message: string } }) => (r.ok ? "" : (r.error?.message ?? ""));

test("audio from another owner chat reaches transcription; a contact's or an outside turn's does not", async () => {
  const store = env.core.store;
  const other = store.threads.create({
    kind: "loose",
    title: "Northwind",
    agent_ids: ["superagent"],
    project_id: northwind,
  });
  const audio = upload(other.id, "memo.ogg", "audio/ogg");
  const own = caller();
  const heard = await env.core.dispatch("media.transcribe", { media_id: audio, thread: own.thread }, own.ctx);
  // Past the chat check: what is left is the missing transcription engine of a test core.
  assert.doesNotMatch(message(heard), /no audio upload/);
  assert.match(message(heard), /no transcription engine/);

  const outside = caller({ client: "external" });
  const sealed = await env.core.dispatch("media.transcribe", { media_id: audio, thread: outside.thread }, outside.ctx);
  assert.match(message(sealed), /no audio upload/);

  const person = store.persons.create({ name: "Alex Acme", role: "contact" });
  const contact = store.threads.create({
    kind: "loose",
    title: "Alex",
    agent_ids: ["superagent"],
    project_id: northwind,
    channel: { id: "ch_test", conversation: "alex", person_id: person.id },
  });
  const theirs = upload(contact.id, "voice.ogg", "audio/ogg");
  const refused = await env.core.dispatch("media.transcribe", { media_id: theirs, thread: own.thread }, own.ctx);
  assert.match(message(refused), /no audio upload/);
});

test("a task chat's media in another project is readable by the owner's agent, not by an outside turn", async () => {
  const store = env.core.store;
  const taskChat = store.threads.create({
    kind: "loose",
    title: "Northwind task",
    agent_ids: ["superagent"],
    project_id: northwind,
  });
  store.tasks.create({ title: "Ship", project_id: northwind, status: "open", thread_id: taskChat.id, by: "owner" });
  const file = upload(taskChat.id, "notes.txt", "text/plain");
  const own = caller();
  const read = await env.core.dispatch("media.get", { id: file }, own.ctx);
  assert.ok(read.ok, message(read));
  const outside = caller({ client: "external" });
  assert.equal((await env.core.dispatch("media.get", { id: file }, outside.ctx)).ok, false);
});
