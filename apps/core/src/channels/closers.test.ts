import assert from "node:assert/strict";
import { test } from "node:test";
import { asksSomething, asksToStop, needsNoAnswer, reactAnswer, reactionFor } from "./closers.ts";

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

test("an answer that is a reaction", () => {
  assert.equal(reactAnswer("REACT ❤️"), "❤️");
  assert.equal(reactAnswer("**REACT:** 👍"), "👍");
  assert.equal(reactAnswer("react 😂\n"), "😂");
  assert.equal(reactAnswer("REACT to this later"), undefined);
  assert.equal(reactAnswer("I will react ❤️ soon"), undefined);
  for (const e of ["🙌", "🦖", "👨‍💻", "🇦🇷", "👍🏽", "❤"]) assert.equal(reactAnswer(`REACT ${e}`), e, e);
  for (const t of ["REACT ok👍", "REACT 👍👍", "REACT :)"]) assert.equal(reactAnswer(t), undefined, t);
});

test("a short stop asks the agent to stop; a sentence about stopping does not", () => {
  for (const t of ["Pará", "para!!", "Paraaa todo", "basta ya", "STOP", "stop it", "Cancelá", "frená ahí", "Olvidalo"])
    assert.equal(asksToStop(t), true, t);
  for (const t of ["para mañana", "pará y mandame el link", "stop the server", "no pares", "", "parar el deploy?"])
    assert.equal(asksToStop(t), false, t);
});
