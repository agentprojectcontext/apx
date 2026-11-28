import assert from "node:assert/strict";
import { test } from "node:test";
import { manualTimers } from "../testkit/platform.ts";
import {
  createQuickEnding,
  isGoodbye,
  isMissed,
  QUICK_IDLE_MS,
  QUICK_LINES,
  QUICK_WAIT_MS,
  type QuickEndReason,
} from "./quick-request.ts";

test("the owner's goodbye closes a quick request, in Spanish and English, softened or with the agent's name", () => {
  for (const said of [
    "listo",
    "Gracias.",
    "Listo, gracias",
    "listo gracias Roby",
    "Bueno, eso es todo.",
    "cortá",
    "Nada más, gracias.",
    "No, nada más",
    "dale, chau",
    "Muchas gracias",
    "ok, ya está",
    "That's all, thanks",
    "thank you",
    "ok bye",
    "No thanks, that's it",
    "you can hang up",
  ])
    assert.equal(isGoodbye(said, ["Roby"]), true, said);
});

test("anything asked or told along with a closing word goes on", () => {
  for (const said of [
    "Listo, ¿y el horno?",
    "Ok, entonces prendelo",
    "Roby, ¿cómo están los platos?",
    "gracias, ahora poné música",
    "ok",
    "dale",
    "Roby",
    "",
    "thanks, and what's on my calendar",
    "listo listo listo listo listo listo listo listo listo",
  ])
    assert.equal(isGoodbye(said, ["Roby"]), false, said);
});

test("right after the voice asked something, a plain thanks is a yes; only a clear goodbye ends it", () => {
  assert.equal(isGoodbye("Dale, gracias", [], true), false);
  assert.equal(isGoodbye("listo", [], true), false);
  assert.equal(isGoodbye("No, gracias", [], true), true);
  assert.equal(isGoodbye("no, nada más", [], true), true);
  assert.equal(isGoodbye("that's all", [], true), true);
});

test("the voice saying it did not catch the owner is told apart from an answer", () => {
  for (const said of [
    "No te entendí, ¿me repetís?",
    "Perdón, no te escuché bien.",
    "Sorry, I didn't catch that.",
    "¿Cómo?",
  ])
    assert.equal(isMissed(said), true, said);
  for (const said of ["Ya terminó el lavavajillas.", "Dale, lo prendo.", "¿Querés que lo prenda?"])
    assert.equal(isMissed(said), false, said);
});

function clock(pending = () => 0) {
  const timers = manualTimers();
  const ended: Array<[QuickEndReason, string]> = [];
  const q = createQuickEnding({
    locale: "es-AR",
    names: ["Roby"],
    timers,
    pending,
    end: (reason, line) => ended.push([reason, line]),
  });
  /** One exchange: the owner speaks, the voice thinks and answers. */
  const exchange = (heard: string, answer: string) => {
    q.partial(heard.slice(0, 4));
    timers.tick(2_000);
    q.heard(heard);
    q.thinking(true);
    timers.tick(3_000);
    q.thinking(false);
    q.saying();
    timers.tick(4_000);
    q.said(answer);
    q.turnEnd();
  };
  return { timers, ended, q, exchange };
}

test("a quick request goes on for as many turns as the owner wants, and ends on their goodbye with the voice's", () => {
  const { timers, ended, q, exchange } = clock();
  q.ready();
  exchange("Roby, ¿cómo están los platos?", "El lavavajillas terminó hace una hora.");
  timers.tick(QUICK_IDLE_MS - 1);
  exchange("Ok, entonces prendelo de nuevo", "Dale, lo prendo.");
  exchange("¿Y cuánto tarda?", "Una hora y media.");
  assert.deepEqual(ended, [], "talking, thinking and speaking never count as silence");
  q.heard("listo, gracias");
  assert.deepEqual(ended, [["goodbye", QUICK_LINES["es-AR"].goodbye]]);
  timers.tick(QUICK_IDLE_MS * 3);
  assert.equal(ended.length, 1, "it ends once");
});

test("nobody speaking for a while ends it without a word; a task still running waits longer for its answer", () => {
  const idle = clock();
  idle.q.ready();
  idle.exchange("Roby, poné una alarma a las 7", "Listo, a las 7.");
  idle.timers.tick(QUICK_IDLE_MS - 1);
  assert.deepEqual(idle.ended, []);
  idle.timers.tick(1);
  assert.deepEqual(idle.ended, [["idle", ""]]);

  let running = 1;
  const wait = clock(() => running);
  wait.q.ready();
  wait.exchange("¿Qué tengo hoy?", "Dale, dejame que lo veo.");
  wait.timers.tick(QUICK_IDLE_MS);
  assert.deepEqual(wait.ended, [], "the answer is on its way");
  running = 0;
  wait.q.tasks();
  wait.q.saying();
  wait.timers.tick(QUICK_WAIT_MS);
  wait.q.said("Tenés una reunión a las 10.");
  wait.q.turnEnd();
  wait.timers.tick(QUICK_IDLE_MS);
  assert.deepEqual(wait.ended, [["idle", ""]]);

  const stuck = clock(() => 1);
  stuck.q.ready();
  stuck.exchange("¿Qué tengo hoy?", "Dale, dejame que lo veo.");
  stuck.timers.tick(QUICK_WAIT_MS);
  assert.deepEqual(stuck.ended, [["idle", ""]], "a task that never answers does not keep the call open");
});

test("the clock starts when the voice is up, so a voice still loading never hangs up", () => {
  const { timers, ended, q } = clock();
  timers.tick(QUICK_IDLE_MS * 5);
  assert.deepEqual(ended, []);
  q.ready();
  timers.tick(QUICK_IDLE_MS);
  assert.deepEqual(ended, [["idle", ""]]);
});

test("the voice not understanding twice in a row, or its model failing, says so and hangs up", () => {
  const twice = clock();
  twice.q.ready();
  twice.exchange("mmm la cosa esa", "No te entendí, ¿me repetís?");
  assert.deepEqual(twice.ended, []);
  twice.exchange("eso que te dije", "Perdón, no te entendí.");
  assert.deepEqual(twice.ended, [["confused", QUICK_LINES["es-AR"].confused]]);

  const recovered = clock();
  recovered.q.ready();
  recovered.exchange("mmm", "No te entendí, ¿me repetís?");
  recovered.exchange("Prendé el lavavajillas", "Dale, lo prendo.");
  recovered.exchange("ehh", "¿Cómo?");
  assert.deepEqual(recovered.ended, [], "a miss between understood turns starts the count again");

  const failed = clock();
  failed.q.ready();
  failed.q.heard("¿Cómo están los platos?");
  failed.q.thinking(true);
  failed.q.failed();
  assert.deepEqual(failed.ended, [["confused", QUICK_LINES["es-AR"].confused]]);
});
