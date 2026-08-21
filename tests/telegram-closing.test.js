// The closing message of a Telegram turn — and who writes it.
//
// A turn can come back with no closing text at all (the model returned empty,
// or dumped untagged reasoning that had to be suppressed). That must never end
// in silence: the mid-turn notes are held, so the closing is the only place the
// result can arrive. It used to be filled with a canned i18n line in the
// agent's voice. Now the model is asked for it, from what the turn actually
// did, and the canned line is only what goes out when the model can't answer
// either — which is usually the same failure that emptied the turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-test APX home: sendFinalReply writes to the message ledger under it.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-closing-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { sendFinalReply } = await import("../src/core/channels/telegram/reply.js");
const { t } = await import("#core/i18n/index.js");

function makePoller(lang = "es") {
  const sent = [];
  return {
    sent,
    self: {
      globalConfig: { user: { language: lang }, super_agent: { model: "mock:test" } },
      channel: { name: "default" },
      log: () => {},
      _send: async ({ text }) => { sent.push(text); },
    },
  };
}

const base = { chat_id: "1234567890", agentDisplay: "APX" };

test("closing: an empty turn is closed by the model, from what it did", async () => {
  const { self, sent } = makePoller();
  const asked = [];
  await sendFinalReply(self, {
    ...base,
    update_id: 1,
    replyText: "",
    streamedCount: 1,
    lastStreamedText: "Reviso eso",
    saTrace: [{ tool: "read_file" }, { tool: "read_file" }, { tool: "send_email" }],
    authorLineFn: async (o) => { asked.push(o); return "Leí los dos archivos y mandé el mail."; },
  });

  assert.deepEqual(sent, ["Leí los dos archivos y mandé el mail."]);
  assert.equal(asked.length, 1, "one call, on the path that has nothing else to send");
  assert.match(asked[0].context, /Reviso eso/, "it knows what it already said");
  assert.match(asked[0].context, /read_file×2/, "and what it did");
  assert.equal(asked[0].globalConfig, self.globalConfig, "the language comes off the config, not off each caller");
});

test("closing: the canned floor speaks only when the model cannot", async () => {
  const { self, sent } = makePoller();
  await sendFinalReply(self, {
    ...base,
    update_id: 2,
    replyText: "",
    streamedCount: 1,
    lastStreamedText: "Reviso eso",
    saTrace: [{ tool: "read_file" }],
    authorLineFn: async () => "",   // engine down — the usual reason the turn is empty
  });
  assert.deepEqual(sent, [t("telegram.fallback_continue", { lang: "es" })]);
});

test("closing: a turn that did nothing at all still gets its short ack", async () => {
  const { self, sent } = makePoller();
  const asked = [];
  await sendFinalReply(self, {
    ...base,
    update_id: 3,
    replyText: "",
    streamedCount: 0,
    saTrace: null,
    authorLineFn: async (o) => { asked.push(o); return ""; },
  });
  assert.deepEqual(sent, [t("telegram.fallback_listo", { lang: "es" })]);
  assert.equal(asked[0].context, "", "nothing happened — there is nothing to tell it about");
});

test("closing: a turn with a real answer never pays for a line", async () => {
  const { self, sent } = makePoller();
  await sendFinalReply(self, {
    ...base,
    update_id: 4,
    replyText: "Listo, quedó configurado.",
    streamedCount: 1,
    lastStreamedText: "Reviso eso",
    authorLineFn: async () => { throw new Error("must not be called"); },
  });
  assert.deepEqual(sent, ["Listo, quedó configurado."]);
});

test("closing: a turn already fully streamed stays quiet", async () => {
  const { self, sent } = makePoller();
  await sendFinalReply(self, {
    ...base,
    update_id: 5,
    replyText: "Reviso eso",
    streamedCount: 1,
    lastStreamedText: "Reviso eso",   // the closing repeats what already went out
    authorLineFn: async () => { throw new Error("must not be called"); },
  });
  assert.deepEqual(sent, [], "a duplicate is not a closing");
});
