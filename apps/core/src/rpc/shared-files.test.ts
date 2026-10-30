import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
});
after(async () => {
  await env?.core.close();
  env?.cleanup();
});

function media(mime: string, prompt?: string) {
  const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "file";
  return env.core.store.media.add({ kind, mime, bytes: 10, path: `/missing/${mime}`, ...(prompt ? { prompt } : {}) });
}

test("files shared in chats are listed newest first, by kind and project, with the message that shows them", async () => {
  const { store } = env.core;
  store.projects.upsert({ id: "project_acme", name: "Acme" });
  const acme = store.threads.create({
    kind: "loose",
    title: "Launch",
    agent_ids: ["superagent"],
    project_id: "project_acme",
  });
  const loose = store.threads.create({ kind: "loose", title: "Errands", agent_ids: ["superagent"] });
  const photo = media("image/jpeg", "storefront.jpg");
  const clip = media("video/mp4");
  const voice = media("audio/ogg");
  const pdf = media("application/pdf");
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  const add = (thread: string, parts: Part[], s: number) =>
    store.messages.add({ thread_id: thread, author: { kind: "user" }, parts, at: at(s), quiet: true });

  const first = add(
    acme.id,
    [
      { type: "text", text: "The storefront" },
      { type: "image", media_id: photo.id, alt: "image" },
    ],
    1,
  );
  const second = add(acme.id, [{ type: "file", media_id: clip.id, mime: clip.mime, name: "teaser.mp4", bytes: 10 }], 2);
  add(loose.id, [{ type: "audio", media_id: voice.id, mime: voice.mime }], 3);
  const last = add(loose.id, [{ type: "file", media_id: pdf.id, mime: pdf.mime, name: "invoice.pdf", bytes: 10 }], 4);
  add(loose.id, [{ type: "text", text: "No file here" }], 5);

  const all = await env.client.call("media.shared", {});
  assert.deepEqual(
    all.items.map((f) => [f.kind, f.name, f.message_id]),
    [
      ["document", "invoice.pdf", last.id],
      ["audio", "", all.items[1]?.message_id],
      ["video", "teaser.mp4", second.id],
      ["image", "storefront.jpg", first.id],
    ],
  );
  assert.deepEqual(all.counts, { image: 1, video: 1, audio: 1, document: 1 });
  assert.equal(all.items[2]?.project_id, "project_acme");
  assert.equal(all.items[2]?.thread_title, "Launch");
  assert.equal(all.items[0]?.project_id, undefined);

  const videos = await env.client.call("media.shared", { kind: "video" });
  assert.deepEqual(
    videos.items.map((f) => f.media_id),
    [clip.id],
  );
  const inAcme = await env.client.call("media.shared", { project: "project_acme" });
  assert.deepEqual(inAcme.counts, { image: 1, video: 1, audio: 0, document: 0 });
  const outside = await env.client.call("media.shared", { base: true });
  assert.deepEqual(
    outside.items.map((f) => f.thread_id),
    [loose.id, loose.id],
  );

  const page = await env.client.call("media.shared", { limit: 3 });
  assert.equal(page.more, true);
  const rest = await env.client.call("media.shared", { limit: 3, offset: 3 });
  assert.deepEqual(
    rest.items.map((f) => f.message_id),
    [first.id],
  );
  assert.equal(rest.more, false);

  // A message rewritten without its file, or cut from the chat, no longer lists it.
  store.messages.update({ ...first, parts: [{ type: "text", text: "The storefront" }] });
  store.messages.cutFrom(loose.id, last.seq);
  const now = await env.client.call("media.shared", {});
  assert.deepEqual(
    now.items.map((f) => f.media_id),
    [voice.id, clip.id],
  );
});
