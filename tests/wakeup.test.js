// The wake-up greeting: written by the model the owner configured, and on the
// record in the Telegram thread.
//
// On 2026-09-29 a restart sent the owner "Soy Roby, el fiel apoyo de Manu…"
// with a local disk path in it. The greeting was written by a HARDCODED
// `ollama:qwen2.5:14b` — a model nobody had chosen, which usually was not
// loaded (so the greeting was the plain "online. Ready.") and that morning
// happened to answer. And it went straight to the Bot API and nowhere else, so
// when the owner asked Roby where it came from, Roby searched its messages and
// found nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wakeup-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { triggerWakeup, wakeupModel } = await import("#host/daemon/wakeup.js");
const { readGlobalMessages } = await import("#core/stores/messages.js");

const IDENTITY = path.join(process.env.APX_HOME, "identity.json");
const CHAT = "1234567890";

function config(superAgent = {}) {
  return {
    user: { language: "es" },
    telegram: { enabled: true, channels: [{ name: "default", bot_token: "not-a-real-token", chat_id: CHAT }] },
    super_agent: superAgent,
  };
}

function freshIdentity() {
  // No `last_wakeup`, so the 30-minute cooldown does not apply.
  fs.writeFileSync(IDENTITY, JSON.stringify({
    agent_name: "Roby", owner_name: "Ana", owner_context: "Works from /path/to/project",
  }));
}

function harness() {
  const calls = [];
  const sent = [];
  return {
    calls, sent,
    deps: {
      callEngineFn: async (req) => { calls.push(req); return { text: "Arranqué y estoy listo para ayudarte con tus proyectos." }; },
      sendFn: async (_token, chatId, text) => { sent.push({ chatId, text }); return { ok: true, result: { message_id: 4242 } }; },
    },
  };
}

test("the greeting is written by the super-agent's configured model, never a hardcoded one", async () => {
  freshIdentity();
  const h = harness();
  await triggerWakeup(config({ model: "mock:base" }), () => {}, h.deps);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].modelId, "mock:base");
  assert.equal(h.sent[0].text, "Arranqué y estoy listo para ayudarte con tus proyectos.");
});

test("its own model wins over the router model, like every other super-agent turn", () => {
  assert.equal(wakeupModel(config({ model: "mock:router", self_model: "mock:own" })), "mock:own");
  assert.equal(wakeupModel(config({ model: "mock:router" })), "mock:router");
  assert.equal(wakeupModel(config({})), null);
  assert.equal(wakeupModel(config({ model: "not-a-model-id" })), null);
});

test("with no model configured it sends the plain line and asks no model", async () => {
  freshIdentity();
  const h = harness();
  await triggerWakeup(config({}), () => {}, h.deps);
  assert.equal(h.calls.length, 0);
  assert.equal(h.sent[0].text, "Roby online. Ready.");
});

test("the prompt forbids paths, so the owner context cannot leak a disk into Telegram", async () => {
  freshIdentity();
  const h = harness();
  await triggerWakeup(config({ model: "mock:base" }), () => {}, h.deps);
  assert.match(h.calls[0].messages[0].content, /Never include file paths/);
});

test("what went out is in the Telegram thread, attributed to the super-agent", async () => {
  freshIdentity();
  const h = harness();
  await triggerWakeup(config({ model: "mock:base" }), () => {}, h.deps);
  const rows = readGlobalMessages({ channel: "telegram" }).filter((r) => r.meta?.wakeup);
  assert.ok(rows.length >= 1, "the greeting is on the record");
  const row = rows.at(-1);
  assert.equal(row.direction, "out");
  assert.equal(row.body, "Arranqué y estoy listo para ayudarte con tus proyectos.");
  assert.equal(String(row.meta.chat_id), CHAT);
  assert.equal(row.meta.external_id, "4242");
  assert.equal(row.meta.model, "mock:base");
});
