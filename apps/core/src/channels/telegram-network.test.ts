import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";
import { type ChannelConfig, SendError } from "./types.ts";

const config: ChannelConfig = {
  id: "tg",
  type: "telegram",
  label: "Telegram",
  enabled: true,
  agent_id: "roby",
  strangers: "pair",
  concurrency: "queue",
  owner_thread: "home",
};
const TOKEN = "123456:TEST-network";
const connectFailure = () =>
  new TypeError("fetch failed", {
    cause: Object.assign(
      new AggregateError([
        Object.assign(new Error("timeout"), { code: "ETIMEDOUT", syscall: "connect" }),
        Object.assign(new Error("unreachable"), { code: "EHOSTUNREACH", syscall: "connect" }),
      ]),
      { code: "ETIMEDOUT" },
    ),
  });

test("Telegram retries connection timeouts but never an ambiguous timeout after connecting", async (t) => {
  const adapter = telegramAdapter(config, TOKEN, "http://example.test");
  for (const [failure, kind] of [
    [connectFailure(), "retry"],
    [new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }), "retry"],
    [new TypeError("fetch failed", { cause: { code: "ETIMEDOUT", syscall: "read" } }), "uncertain"],
    [new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } }), "uncertain"],
    [
      new TypeError("fetch failed", {
        cause: new AggregateError([{ code: "ETIMEDOUT", syscall: "connect" }, { code: "ECONNRESET" }]),
      }),
      "uncertain",
    ],
  ] as const) {
    const mocked = t.mock.method(globalThis, "fetch", async () => {
      throw failure;
    });
    await assert.rejects(
      adapter.send("1001", { text: "hello" }),
      (err) => err instanceof SendError && err.kind === kind,
    );
    mocked.mock.restore();
  }
});

test("a Telegram reply that never connected is delivered by the outbox on its next attempt", async (t) => {
  const tg = await fakeTelegram(TOKEN);
  const original = globalThis.fetch;
  let failed = false;
  t.mock.method(globalThis, "fetch", (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    if (!failed && String(url).endsWith("/sendMessage") && String(init?.body).includes("Network probe done")) {
      failed = true;
      return Promise.reject(connectFailure());
    }
    return original(...args);
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("Network probe done")),
    channelAdapters: { telegram: (c, token) => telegramAdapter(c, token, tg.url) },
  });
  t.after(async () => {
    await env.core.close();
    await tg.close();
    await env.cleanup();
  });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  const owner = env.core.store.persons.owner();
  env.core.store.persons.link(owner.id, { channel: "tg", external_id: "1001" });
  tg.message({ id: 1001, name: "Owner" }, "hello");
  const until = Date.now() + 6000;
  while (Date.now() < until && !tg.messagesTo(1001).length) await new Promise((r) => setTimeout(r, 25));
  assert.ok(failed);
  assert.equal(tg.messagesTo(1001).length, 1);
  const { items } = await env.client.call("channels.outbox", {});
  const row = items.find((o) => o.text === "Network probe done");
  assert.equal(row?.state, "sent");
  assert.equal(row?.attempts, 2);
});
