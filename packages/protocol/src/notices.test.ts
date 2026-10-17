import assert from "node:assert/strict";
import { test } from "node:test";
import { noticeText } from "./notices.ts";

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
