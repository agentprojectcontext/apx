import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import type { AdapterIO } from "./types.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const ANA = { phone: "5491100000002@s.whatsapp.net", name: "Ana" };
const LOST_VIDEO = "[video — APX cannot read this kind of message yet]";
const MP4 = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(64 * 1024, 7)]);
const PDF = Buffer.from("%PDF-1.4 an invoice");

const llm = scriptedLlm((_req, { said }) => say(`Got it: ${said.slice(0, 20)}`));
let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;

const threadId = () => env.core.store.threads.byConversation("whatsapp", ANA.phone)?.id ?? "";
const theirs = async (): Promise<Message[]> =>
  (await env.client.call("threads.get", { thread: threadId() })).messages.filter((m) => m.author.kind === "person");
const texts = (m: Message | undefined) => (m?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : []));
/** Ana writes, and the agent's answer goes out. */
const anaSays = async (text: string, content?: object) => {
  const answers = wa.textsTo(ANA.phone).length;
  const id = wa.message(ANA, text, content ? { content } : {});
  await waitFor(() => wa.textsTo(ANA.phone).length > answers, `the answer to "${text}"`);
  return id;
};

before(async () => {
  wa = fakeWhatsApp();
  env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({
          dir: `${env.home}/wa`,
          selfOwner: c.self_owner === true,
          lib: async () => wa.lib,
          resendWaitMs: 300,
        }),
    },
  });
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", self_owner: true },
  });
  await waitFor(async () => Boolean((await env.client.call("channels.list", {})).channels[0]?.qr), "a QR");
  wa.scan();
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "linked");
  const ana = await env.client.call("contacts.set", { name: "Ana" });
  await env.client.call("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0002", person: ana.id });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a video and a document kept as placeholders get their files from the phone again, with no new turn", async () => {
  // What APX kept before it read media: the words only. The phone still has the real messages.
  const video = await anaSays(LOST_VIDEO);
  wa.phoneKeeps(video, {
    videoMessage: { mimetype: "video/mp4", fileLength: MP4.length },
    bytes: MP4.toString("base64"),
  });
  const doc = await anaSays("The invoice\n[attachment could not be downloaded: WhatsApp did not hand over the file]");
  wa.phoneKeeps(doc, {
    documentMessage: { caption: "The invoice", fileName: "invoice.pdf", mimetype: "application/pdf" },
    bytes: PDF.toString("base64"),
  });
  await anaSays("did you see them?");
  const calls = llm.calls.length;

  const r = await env.client.call("channels.recover", { thread: threadId() });
  assert.equal(r.asked, 2);
  assert.deepEqual(
    r.recovered.map((x) => x.name),
    ["video.mp4", "invoice.pdf"],
  );
  assert.deepEqual(r.missing, []);
  assert.equal(r.reason, undefined);
  // The phone was asked for exactly those two messages, under the address they came on.
  assert.deepEqual(wa.resendAsked, [
    { remoteJid: ANA.phone, id: video, fromMe: false },
    { remoteJid: ANA.phone, id: doc, fromMe: false },
  ]);

  const [v, d] = (await theirs()).filter((m) => r.recovered.some((x) => x.message_id === m.id));
  const vPart = v?.parts.find((p) => p.type === "file");
  assert.ok(vPart?.type === "file");
  assert.equal(vPart.mime, "video/mp4");
  assert.deepEqual(Buffer.from((await env.client.call("media.get", { id: vPart.media_id })).data, "base64"), MP4);
  assert.deepEqual(texts(v), [], "the placeholder is gone");
  assert.deepEqual(texts(d), ["The invoice"], "the caption stays");
  assert.ok(d?.parts.some((p) => p.type === "file" && p.name === "invoice.pdf"));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(llm.calls.length, calls, "no turn started");

  const again = await env.client.call("channels.recover", { thread: threadId() });
  assert.equal(again.asked, 0);
  assert.match(again.reason ?? "", /No message in this chat is waiting/);
});

test("the phone offline: the message stays as it was and the reason says the phone did not answer", async () => {
  const lost = await anaSays(LOST_VIDEO);
  wa.phoneKeeps(lost, { videoMessage: { mimetype: "video/mp4" }, bytes: MP4.toString("base64") });
  await anaSays("hello?");
  wa.phone.online = false;
  try {
    const r = await env.client.call("channels.recover", { thread: threadId() });
    assert.equal(r.asked, 1);
    assert.deepEqual(r.recovered, []);
    assert.equal(r.missing.length, 1);
    assert.match(r.reason ?? "", /did not answer: the phone has to be online/);
    const kept = (await theirs()).find((m) => m.id === r.missing[0]?.message_id);
    assert.deepEqual(texts(kept), [LOST_VIDEO], "unchanged");
    assert.ok(!kept?.parts.some((p) => p.type === "file"));
  } finally {
    wa.phone.online = true;
  }
});

test("a chat off any channel is told so; asked again with the phone back, the file comes", async () => {
  await assert.rejects(env.client.call("channels.recover", { thread: "home" }), /not on a channel/);
  const r = await env.client.call("channels.recover", { thread: threadId() });
  assert.equal(r.recovered.length, 1, "with the phone back online, the one that waited comes");
});

test("adapter: after a restart, a message that came under someone's private id is asked again under it", async () => {
  const BOB = { phone: "5491100000003@s.whatsapp.net", name: "Bob", lid: "200000000000003@lid" };
  const fake = fakeWhatsApp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-"));
  const got: string[] = [];
  const linked = async () => {
    const adapter = whatsappAdapter({ dir, selfOwner: true, lib: async () => fake.lib, resendWaitMs: 200 });
    let up = false;
    const io: AdapterIO = {
      receive: (m) => got.push(m.external_id),
      action: () => {},
      status: () => {},
      qr: (code) => code && fake.scan(),
      identified: () => {
        up = true;
      },
      signal: new AbortController().signal,
    };
    await adapter.start(io);
    await waitFor(() => up, "linked");
    return adapter;
  };
  const first = await linked();
  const id = fake.message(BOB, "", {
    content: { videoMessage: { mimetype: "video/mp4" }, bytes: MP4.toString("base64") },
  });
  await waitFor(() => got.includes(id), "Bob's video");
  await first.stop();

  const again = await linked();
  const r = await again.recover?.(BOB.phone, [{ id, fromMe: false }]);
  assert.equal(r?.found[0]?.file?.name, "video.mp4");
  assert.deepEqual(Buffer.from(r?.found[0]?.file?.data ?? "", "base64"), MP4);
  assert.deepEqual(fake.resendAsked, [{ remoteJid: BOB.lid, id, fromMe: false }]);
  assert.equal(got.length, 1, "the message sent again is not news");
  await again.stop();
  await removeDir(dir);
});
