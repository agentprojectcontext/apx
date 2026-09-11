// The project-type picker, guarded at the source.
//
// Two things here are decisions, not accidents, and both look identical to a
// refactor that undoes them: the ORDER (you pick "other" when nothing else
// fits, so it cannot be first) and the fact that each type's sentence is
// written ONCE and shown twice — greyed under the option while choosing, and
// under the field once chosen. A second sentence for the same type is how the
// two drift apart until they contradict each other.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DIALOG = fs.readFileSync("src/interfaces/web/src/components/AddProjectDialog.tsx", "utf8");
const EN = fs.readFileSync("src/interfaces/web/src/i18n/en.ts", "utf8");
const ES = fs.readFileSync("src/interfaces/web/src/i18n/es.ts", "utf8");

const SHARED = fs.readFileSync("src/interfaces/web/src/components/config/projectKinds.ts", "utf8");
const KINDS = [...SHARED.matchAll(/\{ value: "(\w+)", label: t\("settings_ui\.kind_\w+"\), description: t\("add_project\.(\w+)"\) \}/g)];

test("the five types have ONE definition, shared by the dialog and the config tab", () => {
  // A project typed wrong at creation must be retypeable without unregistering
  // it, and the two places that offer the choice cannot drift apart.
  assert.match(DIALOG, /projectKindOptions\(\)/);
  assert.match(
    fs.readFileSync("src/interfaces/web/src/components/config/project-config-sections.ts", "utf8"),
    /path: "kind"[\s\S]*?options: projectKindOptions\(\)/,
  );
});

test("every type is offered, and `other` is last", () => {
  assert.deepEqual(KINDS.map((m) => m[1]), ["personal", "app", "company", "software", "other"]);
});

test("company is what the dialog opens on", () => {
  // It is the only type that DOES something — areas, roles, a team — so it is
  // the one worth offering first. Reset has to agree, or closing and reopening
  // the dialog silently changes what you are about to create.
  assert.match(DIALOG, /useState\("company"\)/);
  assert.match(DIALOG, /setKind\("company"\)/);
});

test("each type has one sentence, and the field reuses it", () => {
  assert.equal(KINDS.length, 5);
  for (const [, value, key] of KINDS) {
    assert.equal(key, `kind_${value}_desc`, `${value} should describe itself`);
    for (const [name, file] of [["en", EN], ["es", ES]]) {
      assert.match(file, new RegExp(`\\b${key}: "`), `${key} missing from ${name}.ts`);
    }
  }
  // The hint under the field is THE SELECTED OPTION'S description, not a sixth
  // string kept in agreement with the other five by hand.
  assert.match(DIALOG, /hint=\{KINDS\.find\(\(k\) => k\.value === kind\)\?\.description\}/);
  // The generic one-size sentence is gone from the add_project block: what is
  // left is one per type.
  const addProject = EN.slice(EN.indexOf("add_project: {"), EN.indexOf("mobile: {"));
  assert.doesNotMatch(addProject, /kind_hint:/);
});

test("the team is only offered for a company, and says what it creates", () => {
  assert.match(DIALOG, /kind === "company" && withTeam \? "company" : undefined/);
  assert.match(EN, /team_hint: "Creates a CEO/);
});
