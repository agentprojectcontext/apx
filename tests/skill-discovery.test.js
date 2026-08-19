// How the super-agent finds a skill on disk.
//
// Two silent failures met here. `readdirSync({withFileTypes:true})` reports a
// symlink-to-directory as isSymbolicLink() and NOT isDirectory(), so a skill
// linked in from wherever an external tool manages it (`npx skills add`
// installs to ~/.agents/skills/) was skipped without a word — the user sees
// their skill missing and nothing explains why. And a third-party SKILL.md
// writes its description as a block scalar, which the flat frontmatter parser
// read as the literal "|": the skill listed, but with no description to match
// on it could never be surfaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listSkills, loadSkill } from "#core/agent/skills/loader.js";
import { apcSkillsDir } from "#core/apc/paths.js";

const SKILL = [
  "---",
  "name: linked",
  "description: |",
  "  Rewrite text that sounds AI-generated while keeping the writer's facts,",
  "  meaning, and voice.",
  "metadata:",
  '  version: "2.11.1"',
  "---",
  "",
  "# Body",
  "",
  "Instructions.",
].join("\n");

/** A project with `.apc/skills/` plus a detached dir the project can link to. */
function scaffold(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `apx-skill-${name}-`));
  const skillsDir = apcSkillsDir(root);
  fs.mkdirSync(skillsDir, { recursive: true });
  const external = path.join(root, "external", "linked");
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, "SKILL.md"), SKILL);
  return { root, skillsDir, external };
}

test("a symlinked skill directory is discovered", () => {
  const { root, skillsDir, external } = scaffold("symlink");
  fs.symlinkSync(external, path.join(skillsDir, "linked"), "dir");

  const found = listSkills({ projectPath: root }).find((s) => s.slug === "linked");
  assert.ok(found, "a symlinked skill dir was skipped");
  assert.equal(found.source, "project");

  fs.rmSync(root, { recursive: true, force: true });
});

test("a symlinked skill loads its body and its block-scalar description", () => {
  const { root, skillsDir, external } = scaffold("body");
  fs.symlinkSync(external, path.join(skillsDir, "linked"), "dir");

  const skill = loadSkill("linked", { projectPath: root });
  assert.match(skill.description, /^Rewrite text that sounds AI-generated/);
  assert.ok(skill.description.includes("\n"), "the block scalar collapsed to one line");
  assert.notEqual(skill.description, "|");
  assert.equal(skill.frontmatter["metadata.version"], "2.11.1");
  assert.match(skill.body, /^# Body/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("a broken symlink is skipped, not thrown on", () => {
  const { root, skillsDir } = scaffold("broken");
  fs.symlinkSync(path.join(root, "does-not-exist"), path.join(skillsDir, "ghost"), "dir");

  const slugs = listSkills({ projectPath: root }).map((s) => s.slug);
  assert.ok(!slugs.includes("ghost"));

  fs.rmSync(root, { recursive: true, force: true });
});

test("a symlink to a flat <slug>.md skill is discovered", () => {
  const { root, skillsDir } = scaffold("flat");
  const target = path.join(root, "external", "flat.md");
  fs.writeFileSync(target, SKILL);
  fs.symlinkSync(target, path.join(skillsDir, "flat.md"), "file");

  assert.ok(listSkills({ projectPath: root }).some((s) => s.slug === "flat"));

  fs.rmSync(root, { recursive: true, force: true });
});
