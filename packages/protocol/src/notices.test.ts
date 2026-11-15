import assert from "node:assert/strict";
import { test } from "node:test";
import { noticeChannelChoice, noticeText } from "./notices.ts";

const paused = {
  code: "breaker.paused",
  text: "Paused: agents spent 777k tokens on their own since you last wrote here; they wait for you before going on.",
  vars: { variant: "tokens", spent: "777k", who: "Fausto" },
};

test("a notice reads in the app's language, its variant's wording filled with its vars", () => {
  assert.match(noticeText(paused, "es"), /^En pausa: los agentes gastaron 777k tokens[\s\S]*Fausto terminó/);
  assert.match(noticeText(paused, "en"), /777k[\s\S]*Fausto/);
});

test("the core's own text stays when there is no translation or it carries details", () => {
  assert.equal(noticeText({ code: "part.unknown", text: "Needs a newer APX." }, "es"), "Needs a newer APX.");
  const failed = { code: "run.failed", text: "Could not finish: HTTP 429" };
  assert.equal(noticeText(failed, "es"), failed.text);
  assert.equal(noticeText({ code: "run.failed", text: "Could not finish." }, "es"), "No pude terminar.");
});

test("a notice whose own wording has a colon still reads translated: only details keep the core's text", () => {
  const quiet = { code: "routine.watch.quiet", text: "Nothing new to watch: the model was not called." };
  assert.equal(noticeText(quiet, "es"), "Nada nuevo que vigilar: no se llamó al modelo.");
});

test("a failure said by its kind reads in plain words; the raw reason is not its text", () => {
  const failed = {
    code: "run.failed",
    text: "Could not finish: acme/model-1: fetch failed (ENOTFOUND)",
    vars: { variant: "network" },
  };
  assert.equal(noticeText(failed, "es"), "No se pudo llegar al proveedor del modelo: sin conexión.");
  assert.doesNotMatch(noticeText(failed, "en"), /ENOTFOUND|acme/);
});

test("every app reads the chat app for notices the same way; an old phone choice is the app only (DECISIONS.md#d-161)", () => {
  assert.equal(noticeChannelChoice(undefined), "auto");
  assert.equal(noticeChannelChoice("none"), "none");
  assert.equal(noticeChannelChoice("device:dev_1"), "none");
  assert.equal(noticeChannelChoice("tg"), "tg");
});
