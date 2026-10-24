import assert from "node:assert/strict";
import fs from "node:fs";
import { type TestContext, test } from "node:test";
import { UPLOAD_LIMITS } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { scratchRoot } from "../tools/folders.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-attachments";
const OWNER = { id: 1001, name: "Owner" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const PDF = Buffer.from("%PDF-1.4\nreceipt\n%%EOF");

async function setup(t: TestContext) {
  const tg = await fakeTelegram(TOKEN);
  const llm = scriptedLlm(() => say("Receipt received"));
  const env = await startCore({ llm, channelAdapters: { telegram: (c, token) => telegramAdapter(c, token, tg.url) } });
  t.after(async () => {
    await env.core.close();
    await tg.close();
    await env.cleanup();
  });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  env.core.store.persons.link(env.core.store.persons.owner().id, { channel: "tg", external_id: String(OWNER.id) });
  return { ...env, tg, llm };
}

test("Telegram photo pixels and caption reach a turn, its UI parts and stored media", async (t) => {
  const env = await setup(t);
  env.tg.attachment(OWNER, { bytes: JPEG, mime: "image/jpeg", photo: true, caption: "Read this ticket" });
  await waitFor(() => env.llm.calls.length > 0, undefined, { ms: 8000 });
  await env.settle("home");
  const item = env.llm.calls[0]?.messages.at(-1);
  assert.equal(item?.role, "user");
  if (item?.role !== "user") throw new Error("No input");
  assert.match(item.content, /Read this ticket/);
  assert.equal(item.images?.length, 1);
  const id = item.images?.[0]?.media_id ?? "";
  const media = await env.client.call("media.get", { id });
  assert.deepEqual(Buffer.from(media.data, "base64"), JPEG);
  const chat = await env.client.call("threads.get", { thread: "home" });
  assert.ok(
    chat.messages.some((m) => m.author.kind === "user" && m.parts.some((p) => p.type === "image" && p.media_id === id)),
  );
  await waitFor(() => env.tg.messagesTo(OWNER.id).length > 0, undefined, { ms: 8000 });
});

test("Telegram PDF without caption reaches the chat's temp folder and appears as a downloadable file", async (t) => {
  const env = await setup(t);
  env.tg.attachment(OWNER, { bytes: PDF, mime: "application/pdf", name: "receipt.pdf" });
  await waitFor(() => env.llm.calls.length > 0, undefined, { ms: 8000 });
  await env.settle("home");
  const input = String(env.llm.calls[0]?.messages.at(-1)?.content);
  assert.doesNotMatch(input, /cannot read this kind/);
  const at = /File in your temp folder: ([^ ]+)\. Use/.exec(input)?.[1];
  assert.ok(at);
  assert.ok(at.startsWith(scratchRoot(env.home)));
  assert.deepEqual(fs.readFileSync(at), PDF);
  const chat = await env.client.call("threads.get", { thread: "home" });
  assert.ok(chat.messages.some((m) => m.parts.some((p) => p.type === "file" && p.name === "receipt.pdf")));
});

test("a Telegram video is kept whole and shows as a video the chat plays", async (t) => {
  const env = await setup(t);
  const MP4 = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(3 * 1024 * 1024, 1)]);
  env.tg.attachment(OWNER, { bytes: MP4, mime: "video/mp4", video: true, caption: "Look at this" });
  await waitFor(() => env.llm.calls.length > 0, undefined, { ms: 8000 });
  await env.settle("home");
  const input = String(env.llm.calls[0]?.messages.at(-1)?.content);
  assert.match(input, /Look at this[\s\S]*\[file attached: video\.mp4 \(video\/mp4\)/);
  const chat = await env.client.call("threads.get", { thread: "home" });
  const part = chat.messages.flatMap((m) => m.parts).find((p) => p.type === "file" && p.mime === "video/mp4");
  assert.ok(part?.type === "file");
  assert.equal(part.bytes, MP4.length, "over the composer's 2 MB, kept all the same");
  assert.deepEqual(Buffer.from((await env.client.call("media.get", { id: part.media_id })).data, "base64"), MP4);
  const kept = env.core.store.channels.inbox.latest("tg", String(OWNER.id));
  assert.equal(kept?.files?.[0]?.data, "", "once handled, the inbox keeps no copy of the bytes");
  assert.equal(kept?.files?.[0]?.name, "video.mp4");
});

test("Telegram oversized and failed downloads preserve captions and explain missing attachments", async (t) => {
  const env = await setup(t);
  env.tg.attachment(OWNER, {
    bytes: PDF,
    mime: "application/pdf",
    declaredSize: UPLOAD_LIMITS.channelBytes + 1,
    caption: "Large receipt",
  });
  await waitFor(() => env.llm.calls.length === 1, undefined, { ms: 8000 });
  await env.settle("home");
  assert.match(
    String(env.llm.calls[0]?.messages.at(-1)?.content),
    /Large receipt[\s\S]*attachment could not be downloaded/,
  );
  assert.equal(env.tg.downloads.length, 0);
  env.tg.attachment(OWNER, {
    bytes: Buffer.alloc(UPLOAD_LIMITS.channelBytes + 1),
    mime: "application/pdf",
    declaredSize: 1,
  });
  await waitFor(() => env.llm.calls.length === 2, undefined, { ms: 8000 });
  await env.settle("home");
  assert.match(String(env.llm.calls[1]?.messages.at(-1)?.content), /attachment could not be downloaded/);
  env.tg.failures.set("getFile", [
    { status: 400, body: { ok: false, error_code: 400, description: "file unavailable" } },
  ]);
  env.tg.attachment(OWNER, { bytes: PDF, mime: "application/pdf", caption: "Missing receipt" });
  await waitFor(() => env.llm.calls.length === 3, undefined, { ms: 8000 });
  assert.match(
    String(env.llm.calls[2]?.messages.at(-1)?.content),
    /Missing receipt[\s\S]*attachment could not be downloaded/,
  );
});

test("a contact photo stays in its sealed chat with an untrusted origin", async (t) => {
  const env = await setup(t);
  const contact = env.core.store.persons.create({ name: "Contact", role: "contact" });
  env.core.store.persons.link(contact.id, { channel: "tg", external_id: "2002" });
  env.tg.attachment(
    { id: 2002, name: "Contact" },
    { bytes: JPEG, mime: "image/jpeg", photo: true, caption: "Contact ticket" },
  );
  await waitFor(() => env.llm.calls.length > 0, undefined, { ms: 8000 });
  const item = env.llm.calls[0]?.messages.at(-1);
  assert.match(String(item?.content), /<channel_message[\s\S]*Contact ticket/);
  assert.doesNotMatch(String(item?.content), /File in your temp folder/);
  assert.equal(fs.existsSync(scratchRoot(env.home)), false);
  const thread = env.core.store.threads.byConversation("tg", "2002");
  assert.ok(thread);
  await env.settle(thread.id);
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.equal(home.messages.length, 0);
  const chat = await env.client.call("threads.get", { thread: thread.id });
  assert.ok(chat.messages.some((m) => m.author.kind === "person" && m.parts.some((p) => p.type === "image")));
});

test("a muted contact attachment remains visible without waking the agent", async (t) => {
  const env = await setup(t);
  const contact = env.core.store.persons.create({ name: "Muted contact", role: "contact" });
  await env.client.call("contacts.set", { id: contact.id, name: contact.name, muted: true });
  env.core.store.persons.link(contact.id, { channel: "tg", external_id: "3003" });
  env.tg.attachment({ id: 3003, name: "Muted contact" }, { bytes: PDF, mime: "application/pdf", name: "muted.pdf" });
  await waitFor(() => Boolean(env.core.store.threads.byConversation("tg", "3003")), undefined, { ms: 8000 });
  const thread = env.core.store.threads.byConversation("tg", "3003");
  assert.ok(thread);
  await waitFor(() => env.core.store.messages.list(thread.id).length > 0, undefined, { ms: 8000 });
  const chat = await env.client.call("threads.get", { thread: thread.id });
  assert.ok(chat.messages.some((m) => m.parts.some((p) => p.type === "file" && p.name === "muted.pdf")));
  assert.equal(chat.runs.length, 0);
  assert.equal(env.llm.calls.length, 0);
});

test("transient Telegram metadata failures retry without losing the attachment or duplicating the turn", async (t) => {
  const env = await setup(t);
  env.tg.failures.set("getFile", [{ status: 503, body: { ok: false, error_code: 503, description: "unavailable" } }]);
  env.tg.attachment(OWNER, { bytes: PDF, mime: "application/pdf", name: "retry.pdf", caption: "Retry receipt" });
  await waitFor(() => env.llm.calls.length > 0, undefined, { ms: 8000 });
  await env.settle("home");
  assert.equal(env.llm.calls.length, 1);
  assert.match(String(env.llm.calls[0]?.messages.at(-1)?.content), /Retry receipt/);
  assert.doesNotMatch(String(env.llm.calls[0]?.messages.at(-1)?.content), /could not be downloaded/);
  const chat = await env.client.call("threads.get", { thread: "home" });
  assert.equal(chat.messages.filter((m) => m.author.kind === "user").length, 1);
  assert.ok(chat.messages.some((m) => m.parts.some((p) => p.type === "file" && p.name === "retry.pdf")));
});

test("a reset file download retries, while persistent network errors report their code without credentials", async (t) => {
  const env = await setup(t);
  const original = globalThis.fetch;
  let failures = 1;
  t.mock.method(globalThis, "fetch", (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).includes("/file/") && failures-- > 0)
      return Promise.reject(new TypeError(`request bot${TOKEN} failed`, { cause: { code: "ECONNRESET" } }));
    return original(...args);
  });
  env.tg.attachment(OWNER, { bytes: JPEG, mime: "image/jpeg", photo: true });
  await waitFor(() => env.llm.calls.length === 1, undefined, { ms: 8000 });
  await env.settle("home");
  assert.doesNotMatch(String(env.llm.calls[0]?.messages.at(-1)?.content), /could not be downloaded/);
  failures = 10;
  env.tg.attachment(OWNER, { bytes: PDF, mime: "application/pdf", caption: "Network receipt" });
  await waitFor(() => env.llm.calls.length === 2, undefined, { ms: 8000 });
  await env.settle("home");
  const input = String(env.llm.calls[1]?.messages.at(-1)?.content);
  assert.match(input, /Network receipt[\s\S]*connection failed \(ECONNRESET\)/);
  assert.ok(!input.includes(TOKEN));
});

test("attachment retries honor Telegram retry_after and refuse waits beyond the download deadline", async (t) => {
  const env = await setup(t);
  env.tg.failures.set("getFile", [
    { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 1 } } },
  ]);
  const start = Date.now();
  env.tg.attachment(OWNER, { bytes: PDF, mime: "application/pdf", name: "rate.pdf" });
  await waitFor(() => env.llm.calls.length === 1, undefined, { ms: 8000 });
  assert.ok(Date.now() - start >= 1000);
  await env.settle("home");
  assert.doesNotMatch(String(env.llm.calls[0]?.messages.at(-1)?.content), /could not be downloaded/);
  env.tg.failures.set("getFile", [
    { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 120 } } },
  ]);
  const downloads = env.tg.downloads.length;
  env.tg.attachment(OWNER, { bytes: PDF, mime: "application/pdf" });
  await waitFor(() => env.llm.calls.length === 2, undefined, { ms: 8000 });
  assert.equal(env.tg.downloads.length, downloads);
  assert.match(String(env.llm.calls[1]?.messages.at(-1)?.content), /Telegram HTTP 429/);
});
