// Unit tests for the fuzzy paraphrase detector used to drop restated
// post-tool segments on Telegram (and any other surface that streams text
// in pieces).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLikelyDuplicate } from "#core/util/text-similarity.js";

test("real-world paraphrase from telegram: tech lead at bytetravel", () => {
  const a = "¡Excelente, Manu! ¡Qué bueno saberlo! Sos Tech Lead de Bytetravel para el proyecto Globely y trabajás con Laravel y React, con perfil full stack. ¡Anotado!";
  const b = "¡Excelente, Manu! Qué bueno saber que sos Tech Lead en Bytetravel para el proyecto Globely, y que tu expertise es en Laravel y React como full stack. ¡Eso me da un contexto mucho más claro! ¿Hay algo específico en lo que te gustaría que te ayude o alguna pregunta que tengas sobre esos temas?";
  assert.equal(isLikelyDuplicate(a, b), true);
});

test("exact same string is duplicate", () => {
  assert.equal(isLikelyDuplicate("hola manu, anoté la tarea", "hola manu, anoté la tarea"), true);
});

test("accents and punctuation don't fool the matcher", () => {
  assert.equal(
    isLikelyDuplicate(
      "Anoté que sos desarrollador indie de APX/APC.",
      "anote que sos desarrollador indie de apx apc",
    ),
    true,
  );
});

test("substantively different replies are NOT duplicates", () => {
  const a = "Listame los proyectos registrados.";
  const b = "Acá tenés la lista: default, apx, nicho-apps y iacrm-v2.";
  assert.equal(isLikelyDuplicate(a, b), false);
});

test("greeting + actual answer are NOT duplicates", () => {
  const a = "¡Hola Manu! ¿En qué te puedo ayudar?";
  const b = "Las rutinas configuradas son weather-bariloche y daily-recap.";
  assert.equal(isLikelyDuplicate(a, b), false);
});

test("very short messages skip the check (not enough signal)", () => {
  assert.equal(isLikelyDuplicate("Listo.", "Hecho."), false);
  assert.equal(isLikelyDuplicate("Ok", "Ok"), false);
});

test("empty / null safe", () => {
  assert.equal(isLikelyDuplicate("", "anything"), false);
  assert.equal(isLikelyDuplicate("anything", ""), false);
  assert.equal(isLikelyDuplicate(null, "anything"), false);
  assert.equal(isLikelyDuplicate(undefined, undefined), false);
});

test("short message that is verbatim contained in a longer one is duplicate", () => {
  const a = "Anoté que trabajás con Laravel y React.";
  const b = "Anoté que trabajás con Laravel y React. ¿Algo más en lo que te ayude?";
  assert.equal(isLikelyDuplicate(a, b), true);
});
