import assert from "node:assert/strict";
import { test } from "node:test";
import { addPhrase, isUsual, readVoice, removePhrase, usualWakeWords } from "./wakeWords.ts";

const ok = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const failed: PromiseRejectedResult = { status: "rejected", reason: new Error("socket closed") };

test("the usual phrases follow the super-agent's name, and an empty list means them", () => {
  assert.deepEqual(usualWakeWords("Roby"), ["Ok Roby", "Che Roby", "Hey Roby"]);
  assert.equal(isUsual([], "Roby"), true);
  assert.equal(isUsual(["ok roby", "Che Roby", "HEY ROBY"], "Roby"), true);
  assert.equal(isUsual(["Ok Roby", "Che Roby"], "Roby"), false);
  assert.equal(isUsual(["Ok Roby", "Che Roby", "Hey Roby"], "Alan"), false);
});

test("a phrase is added once, trimmed, and only when it fits", () => {
  assert.deepEqual(addPhrase(["Ok Roby"], "  hola   Roby "), ["Ok Roby", "hola Roby"]);
  assert.deepEqual(addPhrase(["Ok Roby"], "ok roby"), ["Ok Roby"]);
  assert.deepEqual(addPhrase(["Ok Roby"], "x"), ["Ok Roby"]);
  assert.deepEqual(addPhrase([], "x".repeat(61)), []);
  const full = Array.from({ length: 12 }, (_, i) => `Phrase ${i}`);
  assert.deepEqual(addPhrase(full, "One more"), full);
});

test("a phrase is removed whatever its case", () => {
  assert.deepEqual(removePhrase(["Ok Roby", "Che Roby"], "ok roby"), ["Che Roby"]);
});

test("the phrases still show when only the call check fails; both failing means the core could not be read", () => {
  assert.deepEqual(readVoice(ok({ wake_words: ["Ok Roby"] }), failed), {
    state: "loaded",
    wake_words: ["Ok Roby"],
    ready: undefined,
    preparing: false,
  });
  assert.deepEqual(readVoice(ok({ wake_words: [], greeting: "preparing" }), ok({ ready: true })), {
    state: "loaded",
    wake_words: [],
    ready: true,
    preparing: true,
  });
  assert.deepEqual(readVoice(failed, ok({ ready: true })), { state: "unreachable" });
});
