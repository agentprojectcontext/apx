// Tests for stripEmoji (src/core/voice/pronounceable.js) — what a TTS engine
// is allowed to be handed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { stripEmoji } from "#core/voice/pronounceable.js";

test("an emoji is removed without leaving the space it sat in", () => {
  assert.equal(stripEmoji("pegaste justo en el muro correcto 👍"), "pegaste justo en el muro correcto");
  assert.equal(stripEmoji("Voy por partes 👉 primero la plantilla."), "Voy por partes primero la plantilla.");
  assert.equal(stripEmoji("Listo ✅✅ todo verde 🎉"), "Listo todo verde");
});

test("a segment that was only an emoji comes back empty, so the caller can drop it", () => {
  // The point of this case: an emoji has no pronunciation, so the model
  // improvises and the bubble gets two seconds of humming.
  assert.equal(stripEmoji("👍"), "");
  assert.equal(stripEmoji("  🎉  "), "");
});

test("the composed forms go too — joined sequences, flags, skin tones, keycaps", () => {
  assert.equal(stripEmoji("Familia 👨‍👩‍👧‍👦 y bandera 🇦🇷"), "Familia y bandera");
  assert.equal(stripEmoji("Dale 🙌🏽 seguimos"), "Dale seguimos");
  assert.equal(stripEmoji("El 1️⃣ es el primero"), "El 1 es el primero");
});

test("punctuation closes up instead of floating after the emoji it followed", () => {
  assert.equal(stripEmoji("Perfecto 👍, seguimos"), "Perfecto, seguimos");
  assert.equal(stripEmoji("¿Vamos 🤔?"), "¿Vamos?");
});

test("text with nothing to strip is returned as it was", () => {
  assert.equal(stripEmoji("Sin emojis, texto normal."), "Sin emojis, texto normal.");
  assert.equal(stripEmoji("¡Che! ¿Todo bien?"), "¡Che! ¿Todo bien?");
});

test("a missing or empty value is an empty string, never a throw", () => {
  assert.equal(stripEmoji(undefined), "");
  assert.equal(stripEmoji(null), "");
  assert.equal(stripEmoji(""), "");
});
