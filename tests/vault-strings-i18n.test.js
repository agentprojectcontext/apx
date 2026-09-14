// The vault dialog reads in the panel's language — without rewriting the
// templates it is describing.
//
// A template's `role` and `description` are the agent's own data: both land in
// its frontmatter at install and both reach the model (build-agent-system puts
// `Role:` in the prompt). So the template stays English and the overlay answers
// the other question — what the panel shows someone deciding whether to install
// it. A pack's name/description/explain reach nobody but the reader, so those
// are localized outright; they were the two English paragraphs sitting at the
// top of a Spanish dialog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vault-strings-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { vaultDisplayStrings, localizePack } = await import("#core/apc/vault-strings.js");
const { readVaultAgents } = await import("#core/apc/parser.js");
const { readPacks } = await import("#core/apc/agent-packs.js");

test("every bundled template has Spanish display strings", () => {
  const templates = readVaultAgents();
  assert.ok(templates.length >= 15, "the bundle ships the vault");
  for (const a of templates) {
    const es = vaultDisplayStrings(a.slug, a.fields || {}, "es");
    assert.ok(es.role, `${a.slug} must have a role to show`);
    if (a.fields?.Role) {
      assert.notEqual(es.role, a.fields.Role, `${a.slug} role is still English`);
    }
    if (a.fields?.Description) {
      assert.notEqual(es.description, a.fields.Description, `${a.slug} description is still English`);
    }
  }
});

test("both packs introduce themselves in Spanish", () => {
  for (const pack of readPacks()) {
    const es = localizePack(pack, "es-AR");
    assert.notEqual(es.name, pack.name, `${pack.id} name is still English`);
    assert.notEqual(es.explain, pack.explain, `${pack.id} explain is still English`);
    assert.equal(es.id, pack.id, "the id is not a display string");
    assert.deepEqual(es.agents, pack.agents, "membership is not a display string");
  }
});

test("the templates themselves stay English — that copy reaches the model", () => {
  const ceo = readVaultAgents().find((a) => a.slug === "ceo");
  assert.match(ceo.fields.Role, /Chief Executive Officer/);
  const onDisk = fs.readFileSync(
    path.resolve("assets/agent-vault-defaults/ceo.md"),
    "utf8",
  );
  assert.match(onDisk, /^role: Chief Executive Officer$/m);
});

test("an untranslated language falls back instead of blanking the row", () => {
  const ceo = readVaultAgents().find((a) => a.slug === "ceo");
  for (const lang of ["en", "ja", "", null]) {
    const out = vaultDisplayStrings("ceo", ceo.fields, lang);
    assert.equal(out.role, ceo.fields.Role, `${lang} must fall back to the template`);
  }
  // A slug nobody translated still renders.
  const unknown = vaultDisplayStrings("made-up", { Role: "Whatever" }, "es");
  assert.equal(unknown.role, "Whatever");
});

test("a regional tag uses the base language's file", () => {
  const ceo = readVaultAgents().find((a) => a.slug === "ceo");
  assert.deepEqual(
    vaultDisplayStrings("ceo", ceo.fields, "es-AR"),
    vaultDisplayStrings("ceo", ceo.fields, "es"),
  );
});
