import assert from "node:assert/strict";
import { test } from "node:test";
import { isSignal } from "./signal.ts";

test("a signal to APX never shows as words, not even half written", () => {
  for (const t of ["SKIP", "**SKIP**", "REACT ❤️", "REACT: 👍", "RE", "REAC", "S", "STICKER oso con corazón", "STICK"])
    assert.equal(isSignal(t), true, t);
  for (const t of ["Reaccioné", "React is a library", "Skipping today", "Hola", "RECEIVED", "Sticker pack?\nok", ""])
    assert.equal(isSignal(t), false, t);
});
