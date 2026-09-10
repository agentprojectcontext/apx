import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  voiceRepliesActive,
  setVoiceReplyOverride,
  clearVoiceReplyOverride,
  _resetVoiceReplyOverrides,
} from "#core/voice/reply-mode.js";
import { spokenPart } from "#core/channels/telegram/voice-note.js";
import voiceRepliesTool from "#core/agent/tools/handlers/voice-replies.js";

beforeEach(() => _resetVoiceReplyOverrides());

const OFF = {};
const ON = { voice: { voice_replies: true } };

test("off unless configured — upgrading does not start talking at anybody", () => {
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:1" }), false);
  assert.equal(voiceRepliesActive(ON, { key: "telegram:1" }), true);
});

test("driving speaks even when the preference is off", () => {
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:1", driving: true }), true);
});

test("what the owner just asked for wins over both", () => {
  setVoiceReplyOverride("telegram:1", false);
  // Including over driving: they asked for silence with the car moving, and
  // that is still an answer.
  assert.equal(voiceRepliesActive(ON, { key: "telegram:1", driving: true }), false);
  setVoiceReplyOverride("telegram:1", true);
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:1" }), true);
});

test("the choice belongs to one conversation, not to every channel", () => {
  setVoiceReplyOverride("telegram:1", true);
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:2" }), false);
  assert.equal(voiceRepliesActive(OFF, { key: "desktop" }), false);
});

test("reset hands the thread back to the configured default", () => {
  setVoiceReplyOverride("telegram:1", true);
  clearVoiceReplyOverride("telegram:1");
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:1" }), false);
});

test("the tool takes effect on the reply being written, not the next one", () => {
  const handler = voiceRepliesTool.makeHandler({
    channel: "telegram", channelMeta: { chatId: "42" }, globalConfig: OFF,
  });
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:42" }), false);
  const r = handler({ on: true });
  assert.equal(r.voice_replies, true);
  // The send path reads this after the turn — which is what makes "mandame
  // audio" arrive as audio instead of as a promise about later.
  assert.equal(voiceRepliesActive(OFF, { key: "telegram:42" }), true);
});

test("the spoken half stops at a sentence, and the rest stays text", () => {
  const reply = "Salió bien y ya está arriba. Tardó ocho minutos por el build. " +
    "No hay errores en los logs.\n\nEl comando fue:\n\npnpm deploy";
  const heard = spokenPart(reply, { maxChars: 40 });
  assert.equal(heard, "Salió bien y ya está arriba.");
  assert.ok(!heard.includes("pnpm"), "a command must never be read out");
});

test("an early full stop does not turn the audio into a greeting", () => {
  // From a real reply: the salutation ends a sentence at 45 characters and the
  // next ending is past 330, so cutting at the last one inside the budget spoke
  // "…de punta a punta, Manu!" and stopped — three seconds that said less than
  // the notification did.
  const reply = "¡Gestionado y cotizado de punta a punta, Manu! Ya hablé con La Caja, " +
    "le cargué los datos de la Amarok y nos pasaron el presupuesto oficial con suma " +
    "asegurada de cuarenta y dos millones y medio de pesos y treinta por ciento de " +
    "descuento por tres meses. Te dejé los valores abajo.\n\n**Cotización**";
  const heard = spokenPart(reply, { maxChars: 120 });
  assert.ok(heard.includes("cuarenta y dos millones"), "the answer has to survive the cut");
  assert.ok(!heard.includes("**"), "nothing below the blank line is spoken");
});

test("the budget stops a page of sentences, not one long one", () => {
  // Three short sentences run past the cap and get trimmed to whole ones…
  const many = "Uno corto. Dos también corto. Tres igual. Cuatro y último.";
  assert.equal(spokenPart(many, { maxChars: 30 }), "Uno corto. Dos también corto.");
  // …while a single sentence that happens to be long is spoken whole: it is one
  // thought, and cutting it is the mid-sentence truncation this avoids.
  const one = "Corto. " + "palabra ".repeat(60) + "final.";
  assert.ok(spokenPart(one, { maxChars: 100 }).endsWith("final."));
});

test("a long opening with nothing to cut on is left whole, not chopped", () => {
  // Truncating mid-thought is worse than a long sentence — the same reason
  // nothing here cuts by character count.
  const runOn = "a".repeat(300);
  assert.equal(spokenPart(runOn, { maxChars: 40 }), runOn);
});

test("no cap means the model's own paragraph, untouched", () => {
  const driving = "Listo, ya está deployado.";
  assert.equal(spokenPart(driving), driving);
});

test("a reply that opens with code has no sayable half", () => {
  assert.equal(spokenPart("```\nnpm i\n```", { maxChars: 200 }), "");
});
