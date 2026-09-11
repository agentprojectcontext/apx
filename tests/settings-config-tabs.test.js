// Config APX: one home per setting, and a list wherever the answer is a list.
//
// The card under Settings › Avanzado used to carry four tabs — Daemon,
// Super-agent, Telegram, Engines — and three of them were a second, worse
// editor for a screen sitting in the same sidebar. Two editors for one setting
// is two answers to "where do I change this", and the loser is whichever one
// you did not open: the Engines tab held a flat `engines.openai.api_key` while
// Engines & modelos had per-provider base URL, key, active and delete.
//
// What stayed is what has no other home: the daemon's own port/host/log level,
// and the three user.* fields the AGENT reads (prompt-builder takes user.*
// before identity.json). Those three were free-text boxes where "Buenos Aires"
// is not a timezone and nothing said so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = (...p) => fs.readFileSync(path.join(ROOT, "src/interfaces/web/src", ...p), "utf8");

test("Config APX keeps only what no other screen owns", () => {
  const sections = webSrc("components", "config", "global-config-sections.ts");
  const keys = [...sections.matchAll(/^\s*key: "([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ["daemon"], "Daemon (+ the raw JSON tab) and nothing else");

  // Each dropped block must still be editable where it belongs, or this is
  // hiding a setting rather than de-duplicating one.
  const engines = webSrc("components", "settings", "EnginesPanel.tsx");
  assert.match(engines, /engines\.\$\{provider\.slug\}/, "providers own their keys and URLs");
  const superAgent = webSrc("components", "settings", "SuperAgentPanel.tsx");
  assert.match(superAgent, /"super_agent\.permission_mode"/);
  const telegram = webSrc("components", "settings", "TelegramGlobalPanel.tsx");
  assert.match(telegram, /"telegram\.enabled"/);
  assert.match(telegram, /"telegram\.channels"/);
});

test("language, locale and timezone are pickers, not text boxes", () => {
  const sections = webSrc("components", "config", "global-config-sections.ts");
  for (const [path, kind] of [
    ["user.language", "language"],
    ["user.locale", "locale"],
    ["user.timezone", "timezone"],
  ]) {
    const re = new RegExp(`path: "${path.replace(".", "\\.")}",[\\s\\S]{0,240}?kind: "${kind}"`);
    assert.match(sections, re, `${path} is picked from a list, not typed`);
  }
  // And each says WHICH question it is. 41 languages under a bare "Language"
  // reads as the panel's language, which has exactly two.
  assert.match(sections, /Not the panel's language/, "the language field says it is the agent's");

  const editor = webSrc("components", "config", "ConfigTabsEditor.tsx");
  assert.match(editor, /field\.kind === "locale" \|\| field\.kind === "timezone"/, "the long lists search");
  assert.match(editor, /field\.kind === "select" \|\| field\.kind === "language"/, "the short one is a dropdown");
  // The options come from the runtime, so nobody maintains 400 timezones by hand.
  assert.match(editor, /localeOptions\(\)/);
  assert.match(editor, /timezoneOptions\(\)/);
  assert.match(editor, /languageOptions\(\)/);
});

test("the empty option only claims to inherit when something does", () => {
  // "Heredar de la config general" was the label of the empty option in the
  // GENERAL config — telling you to inherit from the file you had open.
  const editor = webSrc("components", "config", "ConfigTabsEditor.tsx");
  assert.match(editor, /t\("settings_ui\.cfg_unset"\)/);
  assert.doesNotMatch(editor, /settings_ui\.cfg_inherit"/);
  for (const lang of ["es", "en"]) {
    const dict = webSrc("i18n", `${lang}.ts`);
    assert.match(dict, /cfg_unset:/, `${lang} has the new label`);
    assert.doesNotMatch(dict, /cfg_inherit:/, `${lang} dropped the old one`);
  }
});

test("the search box matches without accents, and clears when you click it", () => {
  const picker = webSrc("components", "SearchSelect.tsx");
  // "mex" must find "Español (México)". Without folding, the locale list
  // answered that with nothing at all, which reads as "no such locale".
  assert.match(picker, /normalize\("NFD"\)\.replace\(\/\\p\{Diacritic\}\/gu, ""\)/);
  assert.match(picker, /fold\(o\.label\)\.includes\(q\) \|\| fold\(o\.value\)\.includes\(q\)/);
  // Clicking a picker that already holds a value used to drop the caret inside
  // the label, so typing INSERTED into it: "es-AR · Español (Argentimexna)".
  assert.match(picker, /onFocus=\{\(\) => \{ setOpen\(true\); setQuery\(""\); \}\}/);
  assert.match(picker, /onBlur=/, "tabbing away restores the label too");
});

test("the locale list is long, well-formed and has no twins", () => {
  const locales = webSrc("i18n", "locales.ts");
  const block = locales.slice(locales.indexOf("LOCALE_TAGS"), locales.indexOf("] as const"));
  const tags = [...block.matchAll(/"([a-z-A-Z]+)"/g)].map((m) => m[1]);
  assert.ok(tags.length >= 50, `a real list, not three: ${tags.length}`);
  assert.equal(new Set(tags).size, tags.length, "no duplicate tags");
  for (const tag of tags) {
    assert.match(tag, /^[a-z]{2}-[A-Z]{2}$/, `${tag} is a BCP-47 language-REGION tag`);
  }
  // The dialects that started this: the agent reads user.locale before
  // user.language, so "es" and "es-AR" are not the same answer.
  for (const want of ["es-AR", "es-MX", "es-ES", "en-US", "pt-BR"]) {
    assert.ok(tags.includes(want), `${want} must be offered`);
  }
});
