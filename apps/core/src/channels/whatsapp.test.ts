import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { UPLOAD_LIMITS } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import type { AdapterIO } from "./types.ts";
import { toWhatsApp, whatsappAdapter } from "./whatsapp.ts";

const ANA = { phone: "5491100000002@s.whatsapp.net", name: "Ana" };
const BOB = { phone: "5491100000003@s.whatsapp.net", name: "Bob", lid: "200000000000003@lid" };

// A business's menu is answered with one of its options, a sticker with the same one; anything else is echoed.
const llm = scriptedLlm((_req, { system, said }) =>
  system.startsWith("You name chat stickers")
    ? say("thumbs up, all good")
    : said.includes("[sticker: thumbs up")
      ? say("STICKER thumbs up")
      : said.includes("[Options:")
        ? say(said.includes("Claims") ? "2" : "Home")
        : say(`Got it: ${said}`),
);
let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;

const channel = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");

before(async () => {
  wa = fakeWhatsApp();
  env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: `${envDir()}/wa`, selfOwner: c.self_owner === true, lib: async () => wa.lib }),
    },
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});
// The credentials live in the core's own temp home.
const envDir = () => env.home;

test("linking the owner's own phone: a QR waits in the app, and once scanned the number is the owner's address", async () => {
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", self_owner: true },
  });
  await waitFor(async () => Boolean((await channel())?.qr), "a QR to scan");
  const waiting = await channel();
  assert.equal(waiting?.status, "starting");
  assert.equal(waiting?.label, "WhatsApp");

  wa.scan();
  await waitFor(async () => (await channel())?.status === "running", "linked");
  const linked = await channel();
  assert.equal(linked?.qr, undefined, "the QR is gone once spent");
  assert.equal(linked?.account, "+5491100000001");
  const { persons } = await env.client.call("contacts.list", {});
  assert.ok(persons.find((p) => p.role === "owner")?.addresses.some((a) => a.external_id === wa.owner));
  // POSIX modes only: Windows reports fixed bits that say nothing about who may read the folder.
  if (process.platform !== "win32") assert.equal(fs.statSync(wa.dir).mode & 0o777, 0o700);
});

test("a person's profile picture comes from the channel, kept as media; one who shows none has none", async () => {
  const { media_id } = await env.client.call("contacts.avatar", { person: "owner" });
  assert.ok(media_id, "the line's own picture");
  assert.equal((await env.client.call("media.get", { id: media_id ?? "" })).mime, "image/png");
  assert.deepEqual(
    await env.client.call("contacts.avatar", { person: "owner" }),
    { media_id },
    "kept, not asked again",
  );
});

test("codes keep coming for a few rounds while nobody scans, then linking waits for the owner", async () => {
  const fake = fakeWhatsApp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-"));
  const adapter = whatsappAdapter({ dir, lib: async () => fake.lib });
  const codes: string[] = [];
  const states: string[] = [];
  const ac = new AbortController();
  await adapter.start({
    receive: () => {},
    action: () => {},
    status: (s, e) => states.push(`${s}:${e ?? ""}`),
    qr: (c) => c && codes.push(c),
    signal: ac.signal,
  });
  for (let i = 0; i < 3; i++) {
    await waitFor(() => codes.length === i + 1, `code ${i + 1}`);
    fake.expire();
  }
  await waitFor(() => codes.length === 4, "a fourth round");
  assert.deepEqual(states, [], "still linking");
  fake.expire();
  await waitFor(() => states.length === 1, "gave up");
  assert.match(states[0] ?? "", /^error:.*press Link/);
  await adapter.stop();
  await removeDir(dir);
});

test("the owner talks in 'Message yourself'; the answer comes back there once, its echo never starts a turn", async () => {
  const calls = llm.calls.length;
  wa.fromOwner("what is on today?");
  await waitFor(() => wa.textsTo(wa.owner).some((t) => t.includes("Got it: what is on today?")), "the answer");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(
    llm.calls.length - calls,
    1,
    "one turn, with no check first: the echo of the answer is not the owner writing",
  );
  const home = await env.client.call("threads.get", { thread: "home" });
  const asked = home.messages.find((m) => m.parts.some((p) => p.type === "text" && p.text === "what is on today?"));
  const answer = home.messages.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("Got it: what is on today?")),
  );
  // Home holds every channel's words: each says which one, so WhatsApp shows only its own part of it.
  assert.deepEqual([asked?.via, answer?.via], ["whatsapp", "whatsapp"]);
  await env.client.call("threads.send", { thread: "home", text: "and from the app" });
  await waitFor(async () => {
    const all = (await env.client.call("threads.get", { thread: "home" })).messages;
    return all.some((m) => m.parts.some((p) => p.type === "text" && p.text.includes("Got it: and from the app")));
  }, "the app's answer");
  const later = (await env.client.call("threads.get", { thread: "home" })).messages.filter((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("and from the app")),
  );
  assert.deepEqual(
    later.map((m) => m.via),
    [undefined, undefined],
    "what is said in the app is no channel's",
  );
});

test("on WhatsApp the owner's turn keeps notes, writes to people and rooms, and hands the rest off", async () => {
  wa.fromOwner("look up the weather in Bariloche");
  await waitFor(() => wa.textsTo(wa.owner).some((t) => t.includes("Got it: look up the weather")), "the answer");
  const req = llm.calls.at(-1);
  const names = (req?.tools ?? []).map((t) => t.function.name).sort();
  assert.ok(names.includes("delegate") && names.includes("remember"), names.join(", "));
  // What the owner asks to send stays with this agent: another one cannot act on authorization relayed to it.
  assert.ok(names.includes("message_contact") && names.includes("channel_post"), names.join(", "));
  assert.ok(
    !names.some((n) => n.startsWith("shell") || n.startsWith("browser_") || n.startsWith("task_")),
    names.join(", "),
  );
  assert.match(String(req?.messages[0]?.content), /When your owner writes on whatsapp: .*hand the rest off/);
  assert.match(String(req?.messages.at(-1)?.content), /^\[context: [^\]]* · channel: whatsapp · mode: Auto\]/);
});

test("a stranger gets nothing from the owner's number; approved, they get answers", async () => {
  const calls = llm.calls.length;
  wa.message(ANA, "hi, is this Ana's friend?");
  await waitFor(
    async () => (await env.client.call("pairing.list", {})).requests.some((r) => r.name === "Ana"),
    "listed",
  );
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(wa.textsTo(ANA.phone), [], "no code, no answer");
  assert.equal(llm.calls.length, calls);
  const { notifications } = await env.client.call("notifications.list", {});
  assert.ok(!notifications.some((n) => n.title === "Ana"), "the owner's friends writing are not notices");

  const code = (await env.client.call("pairing.list", {})).requests.find((r) => r.name === "Ana")?.code ?? "";
  await env.client.call("pairing.respond", { code, decision: "contact" });
  wa.message(ANA, "are you there?");
  // A contact's words reach the agent marked as untrusted; the scripted answer repeats them.
  await waitFor(
    () => wa.textsTo(ANA.phone).some((t) => t.startsWith("Got it:") && t.includes("are you there?")),
    "the contact's answer",
  );
});

test("what is sent to a contact shows how far it got: sent, then on their phone, then read", async () => {
  const { threads } = await env.client.call("threads.list", {});
  const ana = threads.find((t) => t.channel?.id === "whatsapp" && t.title === "Ana");
  assert.ok(ana, "Ana's chat");
  const last = async () => (await env.client.call("threads.get", { thread: ana.id })).messages.at(-1);
  await waitFor(async () => (await last())?.delivery === "sent", "taken by WhatsApp");
  const out = wa.sent.filter((x) => x.jid === ANA.phone).at(-1);
  wa.receipt(out?.id ?? "", 3);
  await waitFor(async () => (await last())?.delivery === "delivered", "on their phone");
  wa.receipt(out?.id ?? "", 4);
  await waitFor(async () => (await last())?.delivery === "read", "read");
  wa.receipt(out?.id ?? "", 3);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await last())?.delivery, "read", "a late receipt never moves it back");

  // Their emoji on it shows on it, and wakes nobody.
  const calls = llm.calls.length;
  wa.react(ANA, out?.id ?? "", "❤️");
  await waitFor(async () => (await last())?.reactions?.[0]?.emoji === "❤️", "their reaction");
  assert.deepEqual((await last())?.reactions, [{ emoji: "❤️", by: "them" }]);
  wa.react(ANA, out?.id ?? "", "");
  await waitFor(async () => !(await last())?.reactions, "taken off");
  assert.equal(llm.calls.length, calls, "no model call");
});

test("who of the contacts is online: asking starts listening, WhatsApp's word fills it in", async () => {
  assert.deepEqual((await env.client.call("channels.presence", { channel: "whatsapp" })).people, []);
  assert.ok(wa.watched.has(ANA.phone), "subscribed to Ana");
  wa.presence(ANA.phone, "available");
  const ana = (await env.client.call("contacts.list", {})).persons.find((p) => p.name === "Ana");
  await waitFor(
    async () =>
      (await env.client.call("channels.presence", { channel: "whatsapp" })).people.some(
        (p) => p.person_id === ana?.id && p.online,
      ),
    "online",
  );
  wa.presence(ANA.phone, "unavailable", 1_790_000_000);
  await waitFor(async () => {
    const p = (await env.client.call("channels.presence", { channel: "whatsapp" })).people[0];
    return p?.online === false && p.last_seen === new Date(1_790_000_000_000).toISOString();
  }, "gone, last seen");
});

test("a saved contact with no chat yet gets an empty one, and the agent writes to them from it", async () => {
  const carla = await env.client.call("contacts.set", { name: "Carla" });
  await env.client.call("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0004", person: carla.id });
  const thread = await env.client.call("channels.open", { person: carla.id, channel: "whatsapp" });
  assert.equal(thread.channel?.person_id, carla.id);
  assert.equal((await env.client.call("threads.get", { thread: thread.id })).messages.length, 0, "nothing sent yet");
  assert.equal((await env.client.call("channels.open", { person: carla.id, channel: "whatsapp" })).id, thread.id);
  await env.client.call("threads.send", { thread: thread.id, text: "say hi to Carla" });
  await waitFor(
    () => wa.textsTo("5491100000004@s.whatsapp.net").some((t) => t.includes("say hi to Carla")),
    "the agent's words reach Carla",
  );
});

test("a business's verification code (a template with a copy button) is read, not dropped", async () => {
  const auth = { phone: "5491100000010@s.whatsapp.net", name: "Northwind Auth" };
  const pay = { phone: "5491100000011@s.whatsapp.net", name: "Acme Pay" };
  wa.message(auth, "", {
    content: { templateMessage: { hydratedTemplate: { hydratedContentText: "*482913* is your verification code." } } },
  });
  wa.message(pay, "", {
    content: {
      viewOnceMessage: {
        message: { interactiveMessage: { header: { title: "Acme Pay" }, body: { text: "Your code: 771204" } } },
      },
    },
  });
  const listed = async (name: string) =>
    (await env.client.call("pairing.list", {})).requests.find((r) => r.name === name)?.text;
  await waitFor(async () => Boolean((await listed("Northwind Auth")) && (await listed("Acme Pay"))), "both listed");
  assert.equal(await listed("Northwind Auth"), "*482913* is your verification code.");
  assert.equal(await listed("Acme Pay"), "Acme Pay\nYour code: 771204");
});

test("a shared contact card and a shared place reach the agent as words, not dropped", async () => {
  const card = { phone: "5491100000013@s.whatsapp.net", name: "Northwind Card" };
  const place = { phone: "5491100000014@s.whatsapp.net", name: "Northwind Place" };
  wa.message(card, "", {
    content: {
      contactMessage: {
        displayName: "Acme Dentist",
        vcard:
          "BEGIN:VCARD\nVERSION:3.0\nFN:Acme Dentist\nTEL;type=CELL;waid=5491100000099:+54 9 11 0000-0099\nEND:VCARD",
      },
    },
  });
  wa.message(place, "", {
    content: { locationMessage: { degreesLatitude: -34.6, degreesLongitude: -58.4, name: "Acme Clinic" } },
  });
  const listed = async (name: string) =>
    (await env.client.call("pairing.list", {})).requests.find((r) => r.name === name)?.text;
  await waitFor(
    async () => Boolean((await listed("Northwind Card")) && (await listed("Northwind Place"))),
    "both listed",
  );
  assert.equal(await listed("Northwind Card"), "[contact: Acme Dentist, +54 9 11 0000-0099]");
  assert.equal(await listed("Northwind Place"), "[location: Acme Clinic · -34.6, -58.4]");
});

test("a business's menu, answered with one of its options, goes back as that button pressed", async () => {
  const bot = { phone: "5491100000012@s.whatsapp.net", name: "Northwind Insurance" };
  const person = await env.client.call("contacts.set", { name: "Northwind Insurance" });
  await env.client.call("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0012", person: person.id });
  const taps = () => wa.sent.filter((x) => x.jid === bot.phone).map((x) => x.content);

  wa.message(bot, "", {
    content: {
      buttonsMessage: {
        contentText: "How can we help?",
        buttons: [
          { buttonId: "car", buttonText: { displayText: "Car" } },
          { buttonId: "home", buttonText: { displayText: "Home" } },
        ],
      },
    },
  });
  await waitFor(() => taps().length === 1, "the agent answers the buttons");
  assert.deepEqual(taps()[0], { buttonReply: { displayText: "Home", id: "home", index: 1 }, type: "plain" });

  wa.message(bot, "", {
    content: {
      listMessage: {
        description: "Home: what about it?",
        buttonText: "See options",
        sections: [
          {
            rows: [
              { rowId: "quote", title: "Quote" },
              { rowId: "claim", title: "Claims" },
            ],
          },
        ],
      },
    },
  });
  await waitFor(() => taps().length === 2, "the agent answers the list");
  assert.deepEqual(taps()[1], {
    listReply: { title: "Claims", listType: 1, singleSelectReply: { selectedRowId: "claim" } },
  });

  wa.message(bot, "Type your policy number");
  await waitFor(() => taps().length === 3, "words are answered in words");
  assert.match(String(taps()[2]?.text), /^Got it: .*Type your policy number/s, "no menu left to tap");
});

test("someone under their private id is the same person as their number", async () => {
  wa.message(BOB, "hello");
  await waitFor(
    async () => (await env.client.call("pairing.list", {})).requests.some((r) => r.name === "Bob"),
    "listed",
  );
  const req = (await env.client.call("pairing.list", {})).requests.find((r) => r.name === "Bob");
  assert.equal(req?.external_id, BOB.phone);
});

test("a contact's sticker is kept as WhatsApp's, and the agent answers with it as a sticker", async () => {
  // A 1×1 WebP, the file a WhatsApp sticker is.
  const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
  env.core.store.settings.set("model_aux", "openai/gpt-4o-mini");
  wa.message(ANA, "", { content: { stickerMessage: { mimetype: "image/webp" }, bytes: WEBP.toString("base64") } });
  await waitFor(() => wa.sent.some((x) => x.jid === ANA.phone && x.content.sticker), "a sticker back");
  const back = wa.sent.findLast((x) => x.jid === ANA.phone && x.content.sticker);
  assert.deepEqual(back?.content.sticker, WEBP);
  assert.deepEqual(
    env.core.store.stickers.known("whatsapp").map((x) => x.meaning),
    ["thumbs up, all good"],
  );
  assert.equal(env.core.store.stickers.known("telegram").length, 0, "kept as WhatsApp's only");
  assert.ok(!wa.textsTo(ANA.phone).some((t) => /STICKER/.test(t)));
  env.core.store.settings.set("model_aux", "");
});

test("a contact's video, a document of any type and a too-big file: kept to play or download, or explained", async () => {
  const MP4 = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(3 * 1024 * 1024, 1)]);
  const APK = Buffer.from("PK\u0003\u0004 an app");
  wa.message(ANA, "", {
    content: {
      videoMessage: { caption: "Me waiting to be added", mimetype: "video/mp4", fileLength: MP4.length },
      bytes: MP4.toString("base64"),
    },
  });
  wa.message(ANA, "", {
    content: {
      documentWithCaptionMessage: {
        message: {
          documentMessage: {
            caption: "The app",
            fileName: "../tool.apk",
            mimetype: "application/vnd.android.package-archive",
          },
        },
      },
      bytes: APK.toString("base64"),
    },
  });
  wa.message(ANA, "", {
    content: { videoMessage: { mimetype: "video/mp4", fileLength: UPLOAD_LIMITS.channelBytes + 1 } },
  });
  const thread = () => env.core.store.threads.byConversation("whatsapp", ANA.phone);
  const theirs = async () =>
    (await env.client.call("threads.get", { thread: thread()?.id ?? "" })).messages.filter(
      (m) => m.author.kind === "person",
    );
  await waitFor(
    async () => (await theirs()).some((m) => m.parts.some((p) => p.type === "text" && /over 50 MB/.test(p.text))),
    "all three",
    { ms: 8000 },
  );
  const parts = (await theirs()).flatMap((m) => m.parts);
  const video = parts.find((p) => p.type === "file" && p.mime === "video/mp4");
  assert.ok(video?.type === "file");
  assert.equal(video.name, "video.mp4");
  assert.deepEqual(Buffer.from((await env.client.call("media.get", { id: video.media_id })).data, "base64"), MP4);
  const apk = parts.find((p) => p.type === "file" && p.name === "tool.apk");
  assert.ok(apk?.type === "file", "any type is kept, its name without a path");
  assert.equal(apk.mime, "application/vnd.android.package-archive");
  const texts = parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  assert.match(texts, /Me waiting to be added/);
  assert.match(texts, /The app/);
  assert.doesNotMatch(texts, /cannot read this kind/);
  await waitFor(
    () => llm.calls.some((c) => /\[file attached: video\.mp4 \(video\/mp4\)/.test(String(c.messages.at(-1)?.content))),
    "the agent told a video came",
  );
});

test("groups, and the owner writing to a friend on their phone, never reach the agent", async () => {
  const calls = llm.calls.length;
  wa.message(ANA, "group news", { group: "120363000000000001@g.us" });
  wa.ownerTo(ANA, "see you tonight");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(llm.calls.length, calls);
});

test("logged out from the phone: the channel says so and keeps no dead credentials", async () => {
  wa.logOut();
  await waitFor(async () => (await channel())?.status === "error", "the error");
  assert.match((await channel())?.error ?? "", /link it again/);
  assert.ok(!fs.existsSync(wa.dir));
});

test("removing the channel unlinks the device and drops its folder", async () => {
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", self_owner: true },
  });
  await waitFor(async () => Boolean((await channel())?.qr), "a new QR");
  wa.scan();
  await waitFor(async () => (await channel())?.status === "running", "linked again");
  await env.client.call("channels.set", { id: "whatsapp", channel: null });
  assert.equal(wa.loggedOut.value, true);
  assert.ok(!fs.existsSync(wa.dir));
  assert.equal(await channel(), undefined);
});

test("adapter: options go out numbered, a number back presses that option; Markdown reads as WhatsApp", async () => {
  const fake = fakeWhatsApp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-"));
  const adapter = whatsappAdapter({ dir, selfOwner: true, lib: async () => fake.lib });
  const actions: string[] = [];
  const ac = new AbortController();
  const io: AdapterIO = {
    receive: () => {},
    action: (a) => actions.push(a.data),
    status: () => {},
    signal: ac.signal,
  };
  let linked = false;
  io.identified = () => {
    linked = true;
  };
  io.qr = (code) => code && fake.scan();
  await adapter.start(io);
  await waitFor(() => linked, "linked");
  await adapter.send(fake.owner, {
    text: "**Allow** the shell?",
    buttons: [
      { id: "in:1:approve", label: "Allow" },
      { id: "in:1:deny", label: "Deny" },
    ],
  });
  assert.equal(fake.textsTo(fake.owner)[0], "*Allow* the shell?\n\n*1* — Allow\n*2* — Deny");
  fake.fromOwner("2");
  await waitFor(() => actions.length === 1, "the option");
  assert.deepEqual(actions, ["in:1:deny"]);
  assert.equal(toWhatsApp("# Title\n[docs](https://example.com) ~~old~~"), "*Title*\ndocs (https://example.com) ~old~");
  await adapter.stop();
  await removeDir(dir);
});
