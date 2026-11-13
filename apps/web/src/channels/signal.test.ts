import assert from "node:assert/strict";
import { test } from "node:test";
import { isSignal, isSkipAnswer } from "./signal.ts";

test("a signal to APX never shows as words, not even half written", () => {
  for (const t of ["SKIP", "**SKIP**", "REACT ❤️", "REACT: 👍", "RE", "REAC", "S", "STICKER oso con corazón", "STICK"])
    assert.equal(isSignal(t), true, t);
  for (const t of ["Reaccioné", "React is a library", "Skipping today", "Hola", "RECEIVED", "Sticker pack?\nok", ""])
    assert.equal(isSignal(t), false, t);
});

test("only a whole SKIP answer is the agent having nothing to say; a half-written one or a word with it is not", () => {
  for (const t of ["SKIP", "**SKIP**", "`skip`.", " Skip! "]) assert.equal(isSkipAnswer(t), true, t);
  for (const t of ["S", "SKI", "Skipping today", "SKIP this one", "REACT 👍", ""])
    assert.equal(isSkipAnswer(t), false, t);
});
