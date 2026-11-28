import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultWakeWords, wakeMatch } from "./wake.ts";

const roby = defaultWakeWords("Roby");

test("the voice wakes to a call word and its name, however whisper spells it", () => {
  for (const heard of [
    "Ok, Roby.",
    "Okey Robbie",
    "che robi",
    "Hey Roby!",
    "O.K. Roby",
    "Che, Ro bi.",
    "hola roby",
    "Cheroby.",
    "okroby",
  ])
    assert.ok(wakeMatch(heard, roby), heard);
});

test("other words with the name in them do not wake it", () => {
  for (const heard of [
    "Roby dijo que ok",
    "la tele está fuerte",
    "ok",
    "Roby",
    "",
    "okey dale, vamos al súper",
    "che Roberto",
  ])
    assert.equal(wakeMatch(heard, roby), undefined, heard);
});

test("the owner's own phrases wake it too", () => {
  assert.ok(wakeMatch("Despertate Jarvis", ["despertate jarvis"]));
  assert.ok(wakeMatch("oye Jarvis", ["hey jarvis"]));
  assert.equal(wakeMatch("ok Roby", ["hey jarvis"]), undefined);
});

test("the usual phrases are a call word and the super-agent's name", () => {
  assert.deepEqual(defaultWakeWords("Roby"), ["Ok Roby", "Che Roby", "Hey Roby"]);
  assert.deepEqual(defaultWakeWords(" "), []);
});
