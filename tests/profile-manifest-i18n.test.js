// A profile package names and describes ITSELF in the reader's language.
//
// The package could already translate its prompt (PROFILE.es.md) and every one
// of its settings (config.schema.es.json). Its own `name` and `description` had
// no layer at all, so a Spanish panel listed "Company" with an English sentence
// under it — and there was no i18n key to fix, because that string ships inside
// the package, not in the app. A profile installed from anywhere has the same
// need, which is why the translation lives with the package.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-profile-i18n-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { readProfile, localizeProfileManifest, localizeProfileSchema, listProfilesWithState } =
  await import("#core/profiles/index.js");

test("every bundled package ships its Spanish name and description", () => {
  for (const id of ["company", "secretary"]) {
    const p = readProfile(id);
    assert.ok(p, `${id} must be bundled`);
    const es = localizeProfileManifest(p.dir, p.manifest, "es");
    assert.notEqual(es.description, p.manifest.description, `${id} description is still English`);
    assert.ok(es.description.length > 0);
    // Behaviour never comes from the translation.
    assert.equal(es.id, p.manifest.id);
    assert.equal(es.version, p.manifest.version);
    assert.equal(es.scope, p.manifest.scope);
  }
});

test("a regional tag falls back to its base language, and an untranslated one to English", () => {
  const p = readProfile("company");
  const es = localizeProfileManifest(p.dir, p.manifest, "es");
  // es-AR is what this install actually runs on.
  assert.deepEqual(localizeProfileManifest(p.dir, p.manifest, "es-AR"), es);
  // No Japanese translation ships: English, not a blank.
  assert.equal(localizeProfileManifest(p.dir, p.manifest, "ja").description, p.manifest.description);
  assert.equal(localizeProfileManifest(p.dir, p.manifest, "en").description, p.manifest.description);
});

test("the settings of a company project read in Spanish too", () => {
  const p = readProfile("company");
  const en = p.schema.properties;
  const es = localizeProfileSchema(p.dir, p.schema, "es-AR").properties;
  for (const key of Object.keys(en)) {
    assert.ok(es[key], `${key} must survive localization`);
    assert.notEqual(es[key].title, en[key].title, `${key} title is still English`);
    // Validation has one source of truth: types and defaults are never translated.
    assert.equal(es[key].type, en[key].type);
    assert.deepEqual(es[key].default, en[key].default);
  }
});

test("the profiles list localizes against the user's configured language", () => {
  const rows = (lang) => listProfilesWithState({ user: { language: lang } });
  const es = rows("es-AR").find((r) => r.id === "company");
  const en = rows("en").find((r) => r.id === "company");
  assert.ok(es && en);
  assert.notEqual(es.description, en.description);
  assert.equal(es.id, en.id, "the id is not a display string");
});
