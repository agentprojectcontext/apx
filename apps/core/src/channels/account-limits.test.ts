// An account's limits on automatic answers: per contact and for all of its contacts together, each told to the
// owner once.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-limits";
const OWNER = { id: 1101, name: "Owner" };
const ACME = { id: 2301, name: "Acme Buyer" };
const NW = { id: 2302, name: "Northwind Buyer" };

const llm = scriptedLlm((_req, { said }) => say(`Reply: ${said.slice(0, 40)}`));
let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

const toOwner = () => tg.messagesTo(OWNER.id).map((m) => String(m.body.text ?? ""));

/** A contact's message, and the answer it gets. */
async function answered(from: typeof ACME, text: string) {
  const before = tg.messagesTo(from.id).length;
  tg.message(from, text);
  await waitFor(() => tg.messagesTo(from.id).length > before, `an answer to "${text}"`);
}

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", {
    id: "tg",
    channel: {
      type: "telegram",
      label: "Shop",
      agent_id: "superagent",
      limits: { per_contact_hour: 2, per_account_hour: 3 },
    },
    token: TOKEN,
  });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  await env.client.call("contacts.address", { channel: "tg", address: String(OWNER.id) });
  for (const c of [ACME, NW]) {
    const p = await env.client.call("contacts.set", { name: c.name, relation: "client" });
    await env.client.call("contacts.address", { channel: "tg", address: String(c.id), person: p.id });
  }
});

after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("the account keeps its limits", async () => {
  const [ch] = (await env.client.call("channels.list", {})).channels;
  assert.deepEqual(ch?.limits, { per_contact_hour: 2, per_account_hour: 3 });
});

test("past a contact's hourly answers, and then the account's, messages are only kept and the owner hears each once", async () => {
  await answered(ACME, "first");
  await answered(ACME, "second");
  tg.message(ACME, "third");
  await waitFor(() => toOwner().some((t) => /Acme Buyer escribe mucho seguido/.test(t)), "told about the contact");
  assert.equal(tg.messagesTo(ACME.id).length, 2);

  await answered(NW, "hello");
  const calls = llm.calls.length;
  tg.message(NW, "again");
  await waitFor(
    () => toOwner().some((t) => /Shop llegó al tope de respuestas por hora/.test(t)),
    "told about the account",
  );
  tg.message(NW, "and again");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(llm.calls.length, calls, "no more model calls");
  assert.equal(tg.messagesTo(NW.id).length, 1);
  assert.equal(toOwner().filter((t) => /llegó al tope de respuestas por hora/.test(t)).length, 1);
});
