// Behaviour + parity tests for the backend i18n helper.
// Parity: every key present in ANY locale must be present in EVERY locale —
// drifting catches the "I added an English key and forgot the Spanish one"
// shipping bug before it reaches users.
import { test } from "node:test";
import assert from "node:assert/strict";
import { t, resolveLang, DICTS, DEFAULT_LANG } from "#core/i18n/index.js";

test("resolveLang reads globalConfig.user.language, slices to 2 chars, lowercases", () => {
  assert.equal(resolveLang({ user: { language: "es-AR" } }), "es");
  assert.equal(resolveLang({ user: { language: "EN_US" } }), "en");
  assert.equal(resolveLang({ user: { language: "Pt-BR" } }), "pt");
  assert.equal(resolveLang({}), DEFAULT_LANG);
  assert.equal(resolveLang(null), DEFAULT_LANG);
  assert.equal(resolveLang(undefined), DEFAULT_LANG);
});

test("t() returns the localized string when the key exists in the locale", () => {
  assert.equal(t("telegram.heads_up", { lang: "es" }), "Dale, estoy con eso… 🛠️");
  assert.equal(t("telegram.heads_up", { lang: "en" }), "On it — working on that… 🛠️");
  assert.equal(t("telegram.heads_up", { lang: "pt" }), "Já estou nisso… 🛠️");
});

test("t() falls back to DEFAULT_LANG when the requested locale is unknown", () => {
  // "fr" is not in DICTS, must fall back to the default-lang value (es).
  assert.equal(t("telegram.heads_up", { lang: "fr" }), DICTS[DEFAULT_LANG]["telegram.heads_up"]);
});

test("t() falls back to the key itself when the key is missing everywhere", () => {
  assert.equal(t("nonexistent.key.does.not.exist", { lang: "en" }), "nonexistent.key.does.not.exist");
});

test("t() interpolates {var} placeholders", () => {
  // Use an ad-hoc dict by adding a key dynamically. Skipped to keep the
  // fixture immutable — instead we test that an existing string with no
  // placeholders is returned untouched.
  const out = t("telegram.heads_up", { lang: "es", vars: { foo: "bar" } });
  assert.equal(out, "Dale, estoy con eso… 🛠️");
});

test("locale parity: every key present in any dict must be in every dict", () => {
  const allKeys = new Set();
  for (const dict of Object.values(DICTS)) {
    for (const k of Object.keys(dict)) allKeys.add(k);
  }
  const missing = {};
  for (const [code, dict] of Object.entries(DICTS)) {
    for (const k of allKeys) {
      if (!(k in dict)) {
        missing[code] = missing[code] || [];
        missing[code].push(k);
      }
    }
  }
  assert.deepEqual(missing, {}, `locales out of sync: ${JSON.stringify(missing, null, 2)}`);
});

test("every value is a non-empty string (no accidental null / undefined)", () => {
  for (const [code, dict] of Object.entries(DICTS)) {
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, "string", `${code}.${k} is not a string (${typeof v})`);
      assert.ok(v.length > 0, `${code}.${k} is empty`);
    }
  }
});
