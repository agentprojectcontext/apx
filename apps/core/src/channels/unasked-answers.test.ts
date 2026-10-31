// What the super-agent answers to work the owner did not ask for right then (a mail check, a routine): only words for
// the owner reach their chat app; a SKIP or a report of what it already told them stays in the app.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-unasked";
const OWNER_CHAT = 1001;
const REMINDER = "Remember to call the insurer about the car.";

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (said.includes("<emails")) return say("SKIP");
  if (said.includes("remind the owner")) {
    if (afterTool) return say("Reminder sent on Telegram. I asked them to confirm once it is done.");
    return callTool("m1", "message_contact", { to: "me", text: REMINDER, channel: "telegram" });
  }
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

test("a routine that already wrote to the owner does not send them its report of having done so", async () => {
  const before = toOwner().length;
  const r = await env.client.call("routines.set", {
    name: "Insurer",
    agent: "superagent",
    schedule: { kind: "manual" },
    prompt: "remind the owner to call the insurer",
  });
  const { run_id } = await env.client.call("routines.run", { routine: r.id });
  await waitFor(
    async () => (await env.client.call("routines.runs", { routine: r.id })).runs[0]?.delivered !== undefined,
    "ended",
  );
  await new Promise((res) => setTimeout(res, 150));
  assert.deepEqual(toOwner().slice(before), [REMINDER], "the reminder once, never the report about it");
  const run = env.core.store.runs.get(run_id);
  const { thread } = await env.client.call("threads.get", { thread: run?.thread_id ?? "" });
  assert.equal(thread.archived, undefined, "the run's report stays in the app");
});
