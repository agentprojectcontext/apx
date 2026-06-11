// Tests for transcription language resolution.
//
// Bug history:
//   1.15.x unified language to config.user.language (ISO 639-1).
//   transcription.js must fall back to that value when transcription.local.language
//   is "auto" (the default), and must respect an explicit override when set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTranscriptionLanguage } from "#host/daemon/transcription.js";

// ---------------------------------------------------------------------------
// Language priority: explicit local > config.user.language > "auto"
// ---------------------------------------------------------------------------

test("resolveTranscriptionLanguage: explicit local language wins over user config", () => {
  // transcription.local.language is set explicitly — must take priority.
  assert.equal(resolveTranscriptionLanguage({ language: "fr" }, "es"), "fr");
  assert.equal(resolveTranscriptionLanguage({ language: "zh" }, "en"), "zh");
});

test("resolveTranscriptionLanguage: 'auto' falls back to config.user.language", () => {
  // The default local language is "auto" — should use the user's configured language.
  // This is the key regression: if "auto" is not overridden, the model detects language
  // itself which is less accurate than an explicit hint.
  assert.equal(resolveTranscriptionLanguage({ language: "auto" }, "es"), "es");
  assert.equal(resolveTranscriptionLanguage({ language: "auto" }, "pt"), "pt");
});

test("resolveTranscriptionLanguage: empty local language falls back to user config", () => {
  assert.equal(resolveTranscriptionLanguage({ language: "" }, "ja"), "ja");
  assert.equal(resolveTranscriptionLanguage({}, "de"), "de");
});

test("resolveTranscriptionLanguage: returns 'auto' when both local and user config are absent", () => {
  assert.equal(resolveTranscriptionLanguage({ language: "auto" }, ""), "auto");
  assert.equal(resolveTranscriptionLanguage({}, ""), "auto");
});

test("resolveTranscriptionLanguage: user config without language falls through to 'auto'", () => {
  // If config.user exists but has no language key, result must be "auto", not an error.
  assert.equal(resolveTranscriptionLanguage({ language: "auto" }, undefined), "auto");
});

test("resolveTranscriptionLanguage: non-auto explicit local always wins", () => {
  // Ensure that any ISO code other than "auto" in local config is respected.
  for (const lang of ["es", "en", "fr", "zh", "ar", "ko"]) {
    assert.equal(
      resolveTranscriptionLanguage({ language: lang }, "en"),
      lang,
      `local language "${lang}" should take priority over user config "en"`
    );
  }
});

test("resolveTranscriptionLanguage: user language propagated when local is default 'auto'", () => {
  // Simulates the standard post-setup state: local is at its default ("auto"),
  // user has configured "es" via `apx setup` or `apx config set user.language es`.
  const DEFAULT_LOCAL = { model: "small", device: "cpu", compute_type: "int8", language: "auto" };
  assert.equal(resolveTranscriptionLanguage(DEFAULT_LOCAL, "es"), "es");
});
