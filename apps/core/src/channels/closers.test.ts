import assert from "node:assert/strict";
import { test } from "node:test";
import { asksToStop, reactAnswer } from "./closers.ts";

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
