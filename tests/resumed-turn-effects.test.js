// A resumed turn must not re-do what the cut-off turn already did.
//
// The daemon drains its turns on the way down and cuts off whatever cannot
// finish, and a cut-off turn that had really done something is resumed after
// the restart. That resume is only safe because of what is tested here: the
// side-effect ledger starts seeded with the calls the previous life already
// made, so the WhatsApp that already left is answered with "already done"
// instead of leaving twice.
//
// The obvious-looking alternative does not work, which is why this exists.
// Everything needed IS persisted — appendAgentReplyToConversation writes a
// `role: "tool"` row per call, with args and result — but BOTH replay paths
// strip those rows before the model sees them, on purpose: api/exec.js
// openConversation keeps only user/assistant, and agent/a2a/history.js does
// the same after tool exhaust once ate 84% of a thread's context. So the
// resumed model is structurally unable to see what it already ran, and asking
// it nicely in the prompt is a request, not a guarantee. This is the guarantee.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createSideEffectLedger } from "#core/agent/loop/side-effects.js";
import { TOOLS } from "#core/agent/tools/names.js";

test("a seeded call is already spent, so the resumed turn cannot repeat it", () => {
  const args = { chat_id: 7, text: "listo, ya lo mandé" };
  const led = createSideEffectLedger({
    prior: [{ tool: TOOLS.SEND_WHATSAPP, args, result: { ok: true, id: "wamid.1" } }],
  });

  const sig = led.signature(TOOLS.SEND_WHATSAPP, { ...args });
  assert.equal(led.seen(sig), true, "the resumed turn would send it a second time");
  assert.deepEqual(led.previous(sig), { ok: true, id: "wamid.1" },
    "the repeat must be answered with the real previous result, not an empty stub");
});

test("the near-duplicate guard is seeded too — a RE-WORDED repeat is the real risk", () => {
  // This is the half that matters most. A model told "you were interrupted,
  // pick up where you left off" almost never re-emits byte-identical args; it
  // rewrites the sentence. Exact-signature seeding alone would sail straight
  // past that, which is the shape of the 2026-08-30 incident where one inbound
  // WhatsApp became three Telegrams with three different openers.
  const led = createSideEffectLedger({
    prior: [{
      tool: TOOLS.SEND_TELEGRAM,
      args: { chat_id: 7, text: "📲 WhatsApp de Juan Pérez: pregunta por el turno del martes" },
      result: { ok: true },
    }],
  });

  const reworded = { chat_id: 7, text: "📱 *Consulta de Juan Pérez*: pregunta por el turno del martes" };
  assert.equal(led.seen(led.signature(TOOLS.SEND_TELEGRAM, reworded)), false,
    "different args really are a different signature — that is why `said` exists");
  assert.deepEqual(led.nearDuplicate(TOOLS.SEND_TELEGRAM, reworded), { ok: true },
    "the re-worded repeat slipped through — the seed did not reach the near-duplicate check");
});

test("a different message to the same person still goes out", () => {
  // The guard has to stay narrow. A resumed turn that genuinely has something
  // NEW to say must be able to say it, or resuming trades a duplicate message
  // for a swallowed one.
  const led = createSideEffectLedger({
    prior: [{ tool: TOOLS.SEND_TELEGRAM, args: { chat_id: 7, text: "encontré 3 turnos para el martes" }, result: { ok: true } }],
  });
  const different = { chat_id: 7, text: "no hay lugar el miércoles, avisá si querés el jueves" };
  assert.equal(led.seen(led.signature(TOOLS.SEND_TELEGRAM, different)), false);
  assert.equal(led.nearDuplicate(TOOLS.SEND_TELEGRAM, different), null,
    "an unrelated second message was swallowed as a duplicate");
});

test("the same words to a DIFFERENT person go out", () => {
  const led = createSideEffectLedger({
    prior: [{ tool: TOOLS.SEND_TELEGRAM, args: { chat_id: 7, text: "el pedido llega el jueves a la tarde" }, result: { ok: true } }],
  });
  assert.equal(
    led.nearDuplicate(TOOLS.SEND_TELEGRAM, { chat_id: 99, text: "el pedido llega el jueves a la tarde" }),
    null,
    "two people were treated as one because only the text was compared");
});

test("read-only calls are not seeded — re-reading after a restart is correct", () => {
  // list_tasks is legitimately repeated, and a resumed turn SHOULD re-read the
  // world it is picking up: the state may have moved while the daemon was down.
  const led = createSideEffectLedger({
    prior: [{ tool: TOOLS.LIST_TASKS, args: {}, result: { tasks: [] } }],
  });
  assert.equal(led.signature(TOOLS.LIST_TASKS, {}), null,
    "a read-only tool must stay exempt, seeded or not");
});

test("an unseeded ledger behaves exactly as before", () => {
  // The existing per-turn contract is untouched: only a resumed turn passes
  // `prior`, and everything else keeps the ledger that dies with the turn.
  const led = createSideEffectLedger();
  const sig = led.signature(TOOLS.SEND_TELEGRAM, { chat_id: 1, text: "hola" });
  assert.equal(led.seen(sig), false);
});

test("a malformed prior entry is skipped, not fatal", () => {
  // The seed comes off disk, written by a daemon that was in the middle of
  // being killed. A truncated row must not stop the resume from running.
  const led = createSideEffectLedger({
    prior: [null, {}, { args: { a: 1 } }, { tool: TOOLS.SEND_TELEGRAM, args: { chat_id: 1, text: "ok" }, result: 1 }],
  });
  assert.equal(led.seen(led.signature(TOOLS.SEND_TELEGRAM, { chat_id: 1, text: "ok" })), true,
    "the good entry must survive the bad ones");
});

// ── The resume header ───────────────────────────────────────────────────────
//
// The ledger above is the guarantee; this is the judgement. It carries the two
// things the model cannot get anywhere else: what its first life completed
// (because both history replay paths strip tool rows) and — the part no
// mechanism can decide — what was still in flight when the process died.

const { buildResumeHeader, prependResumeHeader } = await import("#core/agent/resume-header.js");

test("the header names the completed calls, so the model is not refused blindly", () => {
  const header = buildResumeHeader({
    effects: [{ tool: TOOLS.SEND_WHATSAPP, args: { to: "+5491122", text: "confirmado para el martes" } }],
    partial_text: "Le avisé a Juan y ahora",
    cut_at: "2026-09-11T18:00:00.000Z",
  });
  assert.match(header, /ALREADY DONE/);
  assert.match(header, /send_whatsapp\(to: \+5491122, text: confirmado para el martes\)/);
  assert.match(header, /already done/i, "the model must be told WHY a repeat gets refused, or the tool looks broken");
  assert.match(header, /Le avisé a Juan y ahora/, "the partial is what the reader already sees — continue from it");
});

test("an in-flight call is flagged as uncertain, never as done", () => {
  // The one thing nothing can decide mechanically. Seeding it would say
  // "already done" about a message that may never have left — trading a
  // duplicate for a silent loss. So it is handed to the agent to check.
  const header = buildResumeHeader({
    effects: [],
    in_flight: [{ tool: TOOLS.SEND_TELEGRAM, args: { chat_id: 7, text: "voy en camino" } }],
  });
  assert.match(header, /UNCERTAIN/);
  assert.match(header, /CHECK before redoing/i);
  assert.doesNotMatch(header.split("UNCERTAIN")[0], /send_telegram/,
    "an in-flight call must not be listed as completed");
});

test("nothing to report means no header at all", () => {
  assert.equal(buildResumeHeader({ effects: [], in_flight: [], partial_text: "" }), "");
  assert.equal(buildResumeHeader(), "");
});

test("the original request is preserved verbatim under the header", () => {
  const out = prependResumeHeader("revisá los turnos del martes", buildResumeHeader({ partial_text: "ya casi" }));
  assert.match(out, /revisá los turnos del martes$/, "the ask itself must survive the scaffolding");
  assert.match(out, /^\[interrupted turn/);
});

test("with no header the prompt is untouched", () => {
  assert.equal(prependResumeHeader("hola", ""), "hola");
});

test("a huge tool argument is truncated, not pasted whole", () => {
  // Fifty steps of a long turn go in here. Uncapped, the header would crowd out
  // the request it is supposed to be context for.
  const header = buildResumeHeader({
    effects: [{ tool: TOOLS.WRITE_FILE, args: { path: "/tmp/x", content: "x".repeat(5000) } }],
  });
  assert.ok(header.length < 700, `header ballooned to ${header.length} chars`);
  assert.match(header, /…/, "it should show it was cut, not silently drop the argument");
});
