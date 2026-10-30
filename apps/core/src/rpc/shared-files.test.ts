import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
const revealed: string[] = [];
const desktop = {
  reveal: async (abs: string) => void revealed.push(abs),
  open: async () => {},
  trash: async () => {},
};
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("Ready")), desktop });
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

  assert.equal(all.items[3]?.path, photo.path);
  const found = await env.client.call("media.shared", { query: "INVOICE" });
  assert.deepEqual(
    found.items.map((f) => f.name),
    ["invoice.pdf"],
  );
  assert.deepEqual(found.counts, { image: 0, video: 0, audio: 0, document: 1 });
  // A % typed by the owner is a character to find, not a wildcard.
  assert.equal((await env.client.call("media.shared", { query: "%" })).items.length, 0);
  const named = (order: "az" | "za" | "old") =>
    env.client.call("media.shared", { order }).then((r) => r.items.map((f) => f.name));
  assert.deepEqual(await named("az"), ["", "invoice.pdf", "storefront.jpg", "teaser.mp4"]);
  assert.deepEqual(await named("za"), ["teaser.mp4", "storefront.jpg", "invoice.pdf", ""]);
  assert.deepEqual(await named("old"), ["storefront.jpg", "teaser.mp4", "", "invoice.pdf"]);

  const page = await env.client.call("media.shared", { limit: 3 });
  assert.equal(page.more, true);
  const rest = await env.client.call("media.shared", { limit: 3, offset: 3 });
  assert.deepEqual(
    rest.items.map((f) => f.message_id),
    [first.id],
  );
  assert.equal(rest.more, false);

  // Open folder shows the kept file itself; a file gone from disk says so.
  const kept = path.join(env.home, "storefront.jpg");
  fs.writeFileSync(kept, "jpg");
  const onDisk = store.media.add({ kind: "image", mime: "image/jpeg", bytes: 3, path: kept });
  await env.client.call("media.reveal", { media_id: onDisk.id });
  assert.deepEqual(revealed, [kept]);
  await assert.rejects(env.client.call("media.reveal", { media_id: photo.id }), /not found|media/);

  // A message rewritten without its file, or cut from the chat, no longer lists it.
  store.messages.update({ ...first, parts: [{ type: "text", text: "The storefront" }] });
  store.messages.cutFrom(loose.id, last.seq);
  const now = await env.client.call("media.shared", {});
  assert.deepEqual(
    now.items.map((f) => f.media_id),
    [voice.id, clip.id],
  );
});
