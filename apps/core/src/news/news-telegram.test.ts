import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const TOKEN = "123456:TEST-news";
const OWNER = { id: 3301, name: "Acme Owner" };

const llm = scriptedLlm((_req, { said }) => {
  if (said.startsWith("APX was updated.")) return say("Your widgets remember now. Want me to update them?");
  return say(`On it: ${said.slice(0, 60)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  tg.message(OWNER, "hola");
  await waitFor(() => tg.messagesTo(OWNER.id).length === 1, "pairing message");
  const code = /(\d{6})/.exec(String(tg.messagesTo(OWNER.id)[0]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "owner" });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("news reach the owner's channel with buttons; a press asks the super-agent as the owner", async () => {
  env.core.store.surfaces.upsert({ name: "weather", title: "Weather", html: "<p>sunny</p>", created_by: "roby" });
  // Calendar connected and the news every owner or a channel's owner gets already heard: this is about the widgets'.
  env.core.store.settings.set("google_account:google-calendar", "owner@example.com");
  env.core.store.settings.set(
    "news_seen",
    JSON.stringify(["more-channels", "teams-line", "super-agent-settings", "owner-check"]),
  );
  const { entries } = await env.client.call("system.news", {});
  const kit = entries.find((e) => e.id === "artifacts-kit");
  assert.equal(kit?.applies, true);
  assert.equal(kit?.seen, false, "a test core tells nothing at start (APX_NEWS is off there)");

  const calls = llm.calls.length;
  const r = await env.client.call("system.news_tell", {});
  assert.deepEqual(r.told, ["artifacts-kit"]);
  assert.equal(r.voiced, true);
  assert.equal(r.sent, true);
  assert.equal(llm.calls.length, calls + 1);
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /widgets remember now/.test(String(m.body.text))), "news");
  const sent = tg.messagesTo(OWNER.id).find((m) => /widgets remember now/.test(String(m.body.text)));
  const markup = sent?.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  const buttons = markup.inline_keyboard.flat();
  assert.deepEqual(
    buttons.map((b) => b.text),
    ["Actualizar mis widgets", "Convertir uno en app"],
  );
  assert.equal((await env.client.call("system.news", {})).entries.find((e) => e.id === "artifacts-kit")?.seen, true);
  assert.deepEqual((await env.client.call("system.news_tell", {})).told, [], "nothing left to tell");

  tg.press(OWNER, buttons[0]?.callback_data ?? "", sent?.message_id);
  await waitFor(
    () => tg.messagesTo(OWNER.id).some((m) => /On it: Review my widgets/.test(String(m.body.text))),
    "answer",
  );
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(
    home.messages.some(
      (m) =>
        m.author.kind === "user" && m.parts.some((p) => p.type === "text" && p.text.startsWith("Review my widgets")),
    ),
    "the press is the owner's words in their chat",
  );
});
