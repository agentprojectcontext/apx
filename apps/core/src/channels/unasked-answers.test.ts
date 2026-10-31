// What the super-agent answers to work the owner did not ask for right then (a mail check, a routine): only words for
// the owner reach their chat app; a SKIP or a report of what it already told them stays in the app.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-unasked";
const OWNER_CHAT = 1001;

const llm = scriptedLlm((_req, { said }) => {
  if (said.includes("<emails")) return say("SKIP");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
const toOwner = () => tg.messagesTo(OWNER_CHAT).map((m) => String(m.body.text ?? m.body.caption ?? ""));

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent" },
    token: TOKEN,
  });
  const owner = env.core.store.persons.owner();
  env.core.store.persons.link(owner.id, { channel: "tg", external_id: String(OWNER_CHAT) });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  // The owner last wrote to Home from Telegram: Home's answers go back there.
  env.core.store.threads.mergeContext("home", { reply_to: { channel: "tg", conversation: String(OWNER_CHAT) } });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("a mail check the super-agent answers SKIP sends nothing to the owner's chat app", async () => {
  const before = toOwner().length;
  const admitted = env.core.engine.admit({
    thread_id: "home",
    agent_id: "superagent",
    trigger: "system",
    origin: { kind: "mail", count: 1 },
    text: '<emails count="1" trust="untrusted">\n{"id":"m1","from":"Bank","subject":"You paid $10"}\n</emails>',
  });
  await env.settle("home", 15_000);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(toOwner().slice(before), [], "the signal never goes out as words");
  const answer = env.core.store.messages.get(env.core.store.runs.get(admitted.id)?.message_id ?? "");
  assert.ok(!answer?.parts.some((p) => p.type === "text" && p.text.trim()), "nor stays as words in Home");
});
