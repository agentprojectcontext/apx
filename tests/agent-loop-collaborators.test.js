// These two guards protect the user directly — one stops a model greeting them
// three times in a turn, the other stops it sending the same Telegram message
// three times. Both used to be loose variables inside runAgent's 551-line body,
// so testing either meant driving a whole agent turn. Nobody did.
import test from "node:test";
import assert from "node:assert/strict";

import { createGreetingGuard } from "#core/agent/loop/greeting-guard.js";
import { createSideEffectLedger } from "#core/agent/loop/side-effects.js";
import { TOOLS } from "#core/agent/tools/names.js";

// ── greeting guard ──────────────────────────────────────────────────────────

test("greeting guard: the first greeting survives, later ones are stripped", () => {
  const g = createGreetingGuard();
  assert.equal(g.apply("¡Hola Manu! Voy a revisar."), "¡Hola Manu! Voy a revisar.");
  assert.equal(g.apply("Hola de nuevo, ya está listo."), "ya está listo.");
});

test("greeting guard: text without a greeting is untouched", () => {
  const g = createGreetingGuard();
  const body = "Revisé el archivo y encontré dos errores.";
  assert.equal(g.apply(body), body);
  assert.equal(g.greeted, false, "a non-greeting must not arm the guard");
  assert.equal(g.apply(body), body, "and must not strip the next segment");
});

test("greeting guard: recognises English and Spanish salutations", () => {
  for (const [first, second, expected] of [
    ["Hi there! Working on it.", "Hi again, done.", "done."],
    ["Buenas tardes. Empiezo.", "Buenas, terminé.", "terminé."],
    ["Hey, arranco.", "Hey, listo.", "listo."],
  ]) {
    const g = createGreetingGuard();
    g.apply(first);
    assert.equal(g.apply(second), expected);
  }
});

test("greeting guard: never eats real content after the salutation", () => {
  const g = createGreetingGuard();
  g.apply("Hola");
  assert.equal(
    g.apply("Hola. El deploy falló por un timeout en el paso 3."),
    "El deploy falló por un timeout en el paso 3."
  );
});

test("greeting guard: empty input passes through", () => {
  const g = createGreetingGuard();
  assert.equal(g.apply(""), "");
  assert.equal(g.apply(null), null);
});

// ── side-effect ledger ──────────────────────────────────────────────────────

test("side-effect ledger: a repeated world-changing call is caught", () => {
  const led = createSideEffectLedger();
  const args = { chat_id: 1, text: "listo" };

  const sig = led.signature(TOOLS.SEND_TELEGRAM, args);
  assert.ok(sig, "send_telegram must be tracked");
  assert.equal(led.seen(sig), false, "first call runs");
  led.record(sig, { ok: true });

  const again = led.signature(TOOLS.SEND_TELEGRAM, { ...args });
  assert.equal(led.seen(again), true, "identical repeat is deduped");
  assert.deepEqual(led.previous(again), { ok: true });
});

// ── The same message, said differently ─────────────────────────────────────
// Exact args are not what reaches a person. On 2026-08-30 one WhatsApp from a
// contact produced THREE Telegram messages to the owner in one turn: same
// event, same quote, three different openers — three signatures, three sends.

test("message ledger: a re-worded repeat of the same message is one message", () => {
  const led = createSideEffectLedger();
  const first = {
    text: '📲 WhatsApp de Juan Pérez: "hacen service de Amarok? cuánto sale el de 60 mil km?" ' +
          "Le respondí que lo consulto con vos.",
  };
  const sig = led.signature(TOOLS.SEND_TELEGRAM, first);
  assert.equal(led.nearDuplicate(TOOLS.SEND_TELEGRAM, first), null, "the first one goes out");
  led.record(sig, { ok: true, sent: 1 }, { name: TOOLS.SEND_TELEGRAM, args: first });

  const reworded = {
    text: '📱 *Consulta WhatsApp de Juan Pérez*: "hacen service de Amarok? cuánto sale el de 60 mil km?" ' +
          "Le respondí que lo consultaba con vos.",
  };
  assert.equal(led.seen(led.signature(TOOLS.SEND_TELEGRAM, reworded)), false, "not an exact match");
  assert.deepEqual(
    led.nearDuplicate(TOOLS.SEND_TELEGRAM, reworded),
    { ok: true, sent: 1 },
    "but the person would read the same thing twice",
  );
});

test("message ledger: a different message still gets through", () => {
  const led = createSideEffectLedger();
  const first = { text: "Juan pregunta por el service de Amarok de 60 mil km." };
  led.record(led.signature(TOOLS.SEND_TELEGRAM, first), { ok: true }, { name: TOOLS.SEND_TELEGRAM, args: first });

  const second = { text: "Encontré tres turnos disponibles para la semana que viene." };
  assert.equal(led.nearDuplicate(TOOLS.SEND_TELEGRAM, second), null);
});

test("message ledger: the same words to a DIFFERENT chat are a different message", () => {
  const led = createSideEffectLedger();
  const text = "El turno quedó confirmado para el jueves a las diez de la mañana.";
  const first = { chat_id: "111", text };
  led.record(led.signature(TOOLS.SEND_TELEGRAM, first), { ok: true }, { name: TOOLS.SEND_TELEGRAM, args: first });

  assert.equal(led.nearDuplicate(TOOLS.SEND_TELEGRAM, { chat_id: "222", text }), null,
    "telling two people the same thing is two messages");
  assert.ok(led.nearDuplicate(TOOLS.SEND_TELEGRAM, { chat_id: "111", text }), "the same chat is not");
});

test("message ledger: a send that carries a file is never a duplicate", () => {
  const led = createSideEffectLedger();
  const caption = "Resumen del service: filtros, aceite y revisión de frenos al día.";
  const text = { text: caption };
  led.record(led.signature(TOOLS.SEND_TELEGRAM, text), { ok: true }, { name: TOOLS.SEND_TELEGRAM, args: text });

  // The payload is the picture, not the words around it. Swallowing this one
  // would trade a duplicate notification for a chart that never arrives.
  assert.equal(
    led.nearDuplicate(TOOLS.SEND_TELEGRAM, { text: caption, photo_path: "/path/to/chart.png" }),
    null,
  );
});

test("message ledger: only message tools are judged this loosely", () => {
  const led = createSideEffectLedger();
  const first = { title: "Comprar filtros de aceite para el service" };
  led.record(led.signature(TOOLS.CREATE_TASK, first), { ok: true }, { name: TOOLS.CREATE_TASK, args: first });
  // Two similar tasks are two tasks — swallowing one loses work, which is not
  // the same trade as swallowing a duplicate notification.
  assert.equal(
    led.nearDuplicate(TOOLS.CREATE_TASK, { title: "Comprar filtros de aire para el service" }),
    null,
  );
});

test("side-effect ledger: different arguments are a different call", () => {
  const led = createSideEffectLedger();
  const a = led.signature(TOOLS.SEND_TELEGRAM, { text: "uno" });
  led.record(a, { ok: true });
  const b = led.signature(TOOLS.SEND_TELEGRAM, { text: "dos" });
  assert.equal(led.seen(b), false, "a second, different message must go out");
});

test("side-effect ledger: read-only tools are never deduped", () => {
  const led = createSideEffectLedger();
  // list_tasks before and after a change is legitimate and must run twice.
  const sig = led.signature(TOOLS.LIST_TASKS, {});
  assert.equal(sig, null);
  assert.equal(led.seen(sig), false);
  led.record(sig, { any: "thing" });
  assert.equal(led.seen(led.signature(TOOLS.LIST_TASKS, {})), false);
});

test("side-effect ledger: every mutating tool is tracked", () => {
  const led = createSideEffectLedger();
  for (const name of [
    TOOLS.SEND_TELEGRAM,
    TOOLS.WRITE_FILE,
    TOOLS.EDIT_FILE,
    TOOLS.RUN_SHELL,
    TOOLS.CREATE_TASK,
    TOOLS.CALL_RUNTIME,
    TOOLS.ADD_PROJECT,
    TOOLS.SET_IDENTITY,
  ]) {
    assert.ok(led.signature(name, {}), `${name} must be deduped`);
  }
});

// Circular args must not throw inside the loop; deduping a little too eagerly
// is safer than sending the same message twice.
test("side-effect ledger: unserializable arguments still yield a signature", () => {
  const led = createSideEffectLedger();
  const circular = { text: "x" };
  circular.self = circular;
  const sig = led.signature(TOOLS.SEND_TELEGRAM, circular);
  assert.match(sig, /unserializable/);
  led.record(sig, { ok: true });
  assert.equal(led.seen(led.signature(TOOLS.SEND_TELEGRAM, circular)), true);
});
