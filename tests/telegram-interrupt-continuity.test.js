// Interrupting a Telegram turn, and what the next one knows about it.
//
// The abort half has worked for a while: a new message stops the running turn
// ("no, stop, do this instead"). The half that was missing is continuity.
// The owner's ask, 2026-09-20: a message sent while a turn is still producing
// text or running a tool should interrupt it, stop that reply, and CONTINUE
// with the new information.
//
// "Continue" is the load-bearing word. The replacement turn used to start
// blind — conversation history filters tool rows out on purpose (they once ate
// 84% of a thread's context), so the work the aborted turn had already done was
// invisible to it, and it would happily send the same WhatsApp a second time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSideEffectLedger } from "#core/agent/loop/side-effects.js";

/** The shape dispatch.js hands forward when a message interrupts a turn. */
function interruptedFrom(controller, now = Date.now()) {
  return {
    text: controller.text || "",
    effects: Array.isArray(controller.effects) ? controller.effects.slice(-20) : [],
    seconds: Math.round((now - (controller.startedAt || now)) / 1000),
  };
}

test("a tool the interrupted turn already ran is not run again", () => {
  // The turn was two tools deep into "avisale a Lucía" when the owner typed
  // something else. Without the seed, the new turn's first move is to send that
  // WhatsApp again.
  const cut = {
    text: "avisale a Lucía que el backlog queda para el lunes",
    startedAt: Date.now() - 42_000,
    effects: [
      { tool: "send_whatsapp", args: { to: "lucia", text: "el backlog queda para el lunes" }, result: { ok: true } },
      { tool: "create_task", args: { title: "curar backlog" }, result: { id: "t_1" } },
    ],
  };
  const handoff = interruptedFrom(cut);
  assert.equal(handoff.seconds, 42);

  const ledger = createSideEffectLedger({ prior: handoff.effects });
  const sig = ledger.signature("send_whatsapp", { to: "lucia", text: "el backlog queda para el lunes" });
  assert.equal(ledger.seen(sig), true, "the replacement turn knows it already went out");
  assert.deepEqual(ledger.previous(sig), { ok: true }, "and what it answered");
});

test("re-wording the same message does not get it past the seed either", () => {
  // A model asked to pick up where it left off rarely re-emits byte-identical
  // args; it re-words them. That is the half the near-duplicate check catches,
  // and seeding through `record` is what turns it on for a resumed turn.
  const ledger = createSideEffectLedger({
    prior: [{
      tool: "send_telegram",
      args: { chat_id: 1, text: "Listo Juli, ya le avisé a Lucía que lo vemos el lunes" },
      result: { ok: true },
    }],
  });
  const restated = ledger.nearDuplicate("send_telegram", {
    chat_id: 1,
    text: "Ya le avisé a Lucía: lo vemos el lunes 👍",
  });
  assert.ok(restated, "same thing, different opener — still the same message");
});

test("an interrupted turn that had done nothing hands over nothing", () => {
  // Three seconds in with no tools is not the same animal as ten minutes and
  // fifty steps. Seeding an empty ledger must not make the next turn cautious
  // about work that never happened.
  const handoff = interruptedFrom({ text: "hola", startedAt: Date.now(), effects: [] });
  assert.deepEqual(handoff.effects, []);
  const ledger = createSideEffectLedger({ prior: handoff.effects });
  assert.equal(ledger.seen(ledger.signature("send_telegram", { chat_id: 1, text: "hola" })), false);
});

test("the handover is capped: a fifty-step turn does not become a fifty-row prompt", () => {
  const effects = Array.from({ length: 50 }, (_, i) => ({ tool: "list_tasks", args: { i }, result: { ok: true } }));
  const handoff = interruptedFrom({ text: "x", startedAt: Date.now(), effects });
  assert.equal(handoff.effects.length, 20);
  assert.equal(handoff.effects[19].args.i, 49, "and it keeps the MOST RECENT twenty, not the oldest");
});

test("a controller from before this existed does not break the handover", () => {
  // `activeRequests` can hold a controller created by the previous daemon build
  // during a rolling restart: no `effects` field at all.
  const handoff = interruptedFrom({ text: "algo", startedAt: Date.now() - 1000 });
  assert.deepEqual(handoff.effects, []);
  assert.equal(handoff.text, "algo");
});
