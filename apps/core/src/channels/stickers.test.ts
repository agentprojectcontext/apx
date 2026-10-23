import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { saveUpload } from "../services/uploads.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { createStickers, stickerAnswer } from "./stickers.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-stickers";
const OWNER = { id: 1101, name: "Owner" };
// A 1×1 WebP, the file a sticker is.
const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const BEAR = "white bear holding a heart balloon, affection";

const naming = (system: string) => system.startsWith("You name chat stickers");
const llm = scriptedLlm((_req, { system, said }) => {
  if (naming(system)) return say(`"${BEAR}."`);
  if (said.includes("send me a dinosaur")) return say("STICKER dinosaur roaring");
  if (said.includes("send me the osito")) return say("STICKER osito con globo");
  if (said.includes("[sticker:")) return say("STICKER heart balloon");
  return say("ok");
});
const namings = () => llm.calls.filter((c) => naming(String(c.messages[0]?.content ?? ""))).length;

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  env.core.store.persons.link(env.core.store.persons.owner().id, { channel: "tg", external_id: String(OWNER.id) });
  // The model that names stickers: one that is not known not to read images.
  env.core.store.settings.set("model_aux", "openai/gpt-4o-mini");
});

after(async () => {
  await env.core.close();
  await tg.close();
  env.cleanup();
});

test("a sticker is kept the moment it arrives, named once, and the agent reads it as what it means", async () => {
  tg.attachment(OWNER, { bytes: WEBP, mime: "image/webp", sticker: { emoji: "❤️" } });
  await until(() => tg.filesTo(OWNER.id).length > 0, "the agent's sticker sent");
  await env.settle("home");
  const [kept] = env.core.store.stickers.known("telegram");
  assert.equal(kept?.meaning, BEAR, "named once, its quotes and full stop taken off");
  assert.equal(kept?.hint, "❤️");
  const asked = llm.calls.find((c) => naming(String(c.messages[0]?.content ?? "")))?.messages.at(-1);
  // The file goes by reference, as every image does: the model layer puts its bytes in the call (llm.test.ts).
  const seen = asked?.role === "user" ? asked.images?.[0] : undefined;
  assert.equal(seen?.media_id, kept?.media_id, "it saw the file");
  assert.equal(seen && "data" in seen, false);
  assert.deepEqual(fs.readFileSync(env.core.store.media.get(kept?.media_id ?? "")?.path ?? ""), WEBP);
  const turn = llm.calls.find((c) => !naming(String(c.messages[0]?.content ?? "")));
  const input = String(turn?.messages.at(-1)?.content);
  assert.match(input, new RegExp(`\\[sticker: ${BEAR}\\]`));
  assert.match(input, /\[stickers\] To answer with a sticker/);

  // The agent answered "STICKER heart balloon": that sticker went back as a sticker, never as words.
  assert.equal(tg.filesTo(OWNER.id).at(-1)?.method, "sendSticker");
  assert.equal(tg.filesTo(OWNER.id).at(-1)?.body.filename, "sticker.webp");
  assert.ok(!tg.messagesTo(OWNER.id).some((m) => /STICKER/.test(String(m.body.text))));
  const home = await env.client.call("threads.get", { thread: "home" });
  const answer = home.messages.at(-1);
  assert.ok(!answer?.parts.some((p) => p.type === "text"), "the STICKER words leave the chat");
  assert.ok(answer?.parts.some((p) => p.type === "image" && p.media_id === kept?.media_id));
  assert.equal(home.thread.preview, `Mandó un sticker: ${BEAR}`);
  assert.equal(env.core.store.stickers.get(kept?.id ?? "")?.sent, 1);
  const { items } = await env.client.call("channels.outbox", { limit: 3 });
  assert.equal(items.find((i) => i.sticker !== undefined)?.sticker, BEAR, "listed by what it shows");

  // The same sticker again is counted, not kept twice nor named again.
  const named = namings();
  const sent = tg.filesTo(OWNER.id).length;
  tg.attachment(OWNER, { bytes: WEBP, mime: "image/webp", sticker: { emoji: "❤️" } });
  await until(() => tg.filesTo(OWNER.id).length > sent, "answered again");
  assert.equal(namings(), named);
  assert.equal(env.core.store.stickers.known("telegram").length, 1);
  assert.equal(env.core.store.stickers.get(kept?.id ?? "")?.seen, 2);
});

test("a sticker the agent was never sent goes nowhere, and the owner hears why", async () => {
  const files = tg.filesTo(OWNER.id).length;
  tg.message(OWNER, "send me a dinosaur");
  await until(async () => {
    const { notifications } = await env.client.call("notifications.list", {});
    return notifications.some((n) => /dinosaur roaring/.test(n.body ?? ""));
  }, "the owner told");
  assert.equal(tg.filesTo(OWNER.id).length, files);
  assert.ok(!tg.messagesTo(OWNER.id).some((m) => /STICKER/.test(String(m.body.text))));
});

test("with no model known to read images, a sticker takes its emoji: nothing names what it cannot see", async () => {
  env.core.store.settings.set("model_aux", "ollama/qwen2.5:14b");
  const named = namings();
  const other = Buffer.concat([WEBP, Buffer.from([0])]);
  tg.attachment(OWNER, { bytes: other, mime: "image/webp", sticker: { emoji: "👍" } });
  await until(() => env.core.store.stickers.known("telegram").some((s) => s.hint === "👍"), "kept");
  assert.equal(env.core.store.stickers.known("telegram").find((s) => s.hint === "👍")?.meaning, "👍");
  assert.equal(namings(), named, "no model was asked");
  await env.settle("home");
  env.core.store.settings.set("model_aux", "openai/gpt-4o-mini");
});

test("a sticker kept unnamed is named later, by its file", async () => {
  const store = env.core.store;
  const media = saveUpload(env.home, store, { name: "sticker.webp", mime: "image/webp", bytes: WEBP });
  const kept = store.stickers.add({ platform: "whatsapp", hash: "unnamed-1", media_id: media.id });
  const asked: string[] = [];
  const stickers = createStickers({
    store,
    home: env.home,
    log: createLog("test", true),
    see: async (_system, _user, image) => {
      asked.push(image.media_id);
      return "mate with a straw, a calm sip";
    },
  });
  await stickers.nameUnnamed();
  assert.deepEqual(asked, [media.id]);
  assert.equal(store.stickers.get(kept.id)?.meaning, "mate with a straw, a calm sip");
  assert.equal(store.stickers.unnamed().length, 0);
});

test("the owner sees a channel's stickers, says what one means, blocks one and forgets another", async () => {
  const { stickers } = await env.client.call("stickers.list", { platform: "telegram" });
  const bear = stickers.find((s) => s.meaning === BEAR);
  assert.ok(bear);
  assert.equal(bear.mime, "image/webp");
  assert.equal(bear.blocked, false);
  assert.equal("hash" in bear, false);

  const renamed = await env.client.call("stickers.set", { id: bear.id, meaning: "osito con globo, te quiero" });
  assert.equal(renamed.meaning, "osito con globo, te quiero");
  await env.client.call("stickers.set", { id: bear.id, blocked: true });
  assert.ok(!env.core.store.stickers.known("telegram").some((s) => s.id === bear.id), "the agent cannot send it");
  // Blocked, the agent's words for it send nothing; unblocked, it goes by the owner's words.
  const files = tg.filesTo(OWNER.id).length;
  const said = async () => {
    const calls = llm.calls.length;
    tg.message(OWNER, "send me the osito");
    await until(() => llm.calls.length > calls, "asked");
    await env.settle("home");
  };
  await said();
  assert.equal(tg.filesTo(OWNER.id).length, files);
  await env.client.call("stickers.set", { id: bear.id, blocked: false });
  await said();
  await until(() => tg.filesTo(OWNER.id).length > files, "sent once unblocked");

  const other = stickers.find((s) => s.id !== bear.id);
  const file = env.core.store.media.get(other?.media_id ?? "")?.path ?? "";
  assert.ok(fs.existsSync(file));
  assert.deepEqual(await env.client.call("stickers.remove", { id: other?.id ?? "" }), { removed: true });
  assert.equal(fs.existsSync(file), false, "its file goes too");
  const after = await env.client.call("stickers.list", { platform: "telegram" });
  assert.deepEqual(
    after.stickers.map((s) => s.id),
    [bear.id],
  );
});

test("STICKER and the words for it, as the agent writes it", () => {
  assert.equal(stickerAnswer("STICKER oso con corazón"), "oso con corazón");
  assert.equal(stickerAnswer('**STICKER**: "thumbs up"'), "thumbs up");
  assert.equal(stickerAnswer("Sticker"), undefined);
  assert.equal(stickerAnswer("Here is a sticker for you\nSTICKER bear"), undefined);
});
