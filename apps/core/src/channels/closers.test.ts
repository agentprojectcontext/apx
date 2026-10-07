import assert from "node:assert/strict";
import { test } from "node:test";
import { asksSomething, needsNoAnswer, reactionFor } from "./closers.ts";

test("a closing message needs no answer", () => {
  for (const t of [
    "oka",
    "Okaaa!",
    "gracias",
    "Muchas graciaaas 🙏",
    "dale, joya",
    "jajaja",
    "Jsjsjs",
    "👍",
    "❤️😂",
    "Thanks!",
    "chau, besos",
    "Buenísimo",
  ])
    assert.equal(needsNoAnswer(t, false), true, t);
});

test("anything with content still gets an answer", () => {
  for (const t of ["ok, y mañana?", "gracias, mandame el link", "Que se yo", "no", "", "dale pero a las 5", "?"])
    assert.equal(needsNoAnswer(t, false), false, t);
});

test("after a question a bare ok may be its answer; asking not to answer still counts", () => {
  assert.equal(needsNoAnswer("ok", true), false);
  assert.equal(needsNoAnswer("👍", true), false);
  assert.equal(needsNoAnswer("No gastes más tokens", true), true);
  assert.equal(needsNoAnswer("jaja no hace falta que respondas", true), true);
  assert.equal(needsNoAnswer("Stop wasting tokens", true), true);
});

test("a question anywhere in the agent's words is open", () => {
  assert.equal(asksSomething("¿Lo mando? Avisame."), true);
  assert.equal(asksSomething("Listo, queda enviado 😄"), false);
});

test("a reaction fits the closing message", () => {
  assert.equal(reactionFor("Muchas gracias!"), "❤️");
  assert.equal(reactionFor("jajaja"), "😂");
  assert.equal(reactionFor("oka, dale"), "👍");
  assert.equal(reactionFor("👍"), undefined);
});
