// Unit tests for scope-aware skill enable/disable policy + handler gating.
//
// Pure logic (no network / disk): the policy module decides, per scope, which
// skills are active. Built-in skills are private — always on. The list_skills /
// load_skill tool handlers must honor the same policy so a disabled skill never
// reaches the agent.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isPrivateSkill,
  isSkillEnabled,
  filterEnabledSkills,
  annotateSkills,
  setSkillEnabled,
  resolveScopeKey,
} from "#core/agent/skills/policy.js";
import listSkillsTool from "#core/agent/tools/handlers/list-skills.js";
import loadSkillTool from "#core/agent/tools/handlers/load-skill.js";

const builtin = { slug: "apx", source: "builtin", description: "APX core" };
const glob = { slug: "apx-rag-demo", source: "global", description: "demo" };

test("built-in skills are private and always enabled", () => {
  assert.equal(isPrivateSkill(builtin), true);
  assert.equal(isPrivateSkill(glob), false);
  const cfg = { skills: { policy: { default: { apx: false } } } };
  // Even an explicit "false" cannot disable a private skill.
  assert.equal(isSkillEnabled(builtin, { config: cfg }), true);
});

test("empty config leaves every skill enabled (backward compatible)", () => {
  assert.equal(isSkillEnabled(glob, {}), true);
  assert.equal(isSkillEnabled(glob, { config: {} }), true);
});

test("default scope disables cascade; project scope overrides independently", () => {
  const cfg = {
    skills: { policy: { default: { "apx-rag-demo": false }, "/proj/a": { "apx-rag-demo": true } } },
  };
  assert.equal(isSkillEnabled(glob, { config: cfg }), false); // super-agent
  assert.equal(isSkillEnabled(glob, { config: cfg, projectPath: "/proj/a" }), true); // re-enabled
  assert.equal(isSkillEnabled(glob, { config: cfg, projectPath: "/proj/b" }), false); // inherits default
});

test("filterEnabledSkills drops disabled non-private skills", () => {
  const cfg = { skills: { policy: { default: { "apx-rag-demo": false } } } };
  const kept = filterEnabledSkills([builtin, glob], { config: cfg });
  assert.deepEqual(kept.map((s) => s.slug), ["apx"]);
});

test("setSkillEnabled writes and clears overrides; empty scope pruned", () => {
  const cfg = {};
  setSkillEnabled(cfg, { slug: "x", enabled: false });
  assert.equal(cfg.skills.policy.default.x, false);
  setSkillEnabled(cfg, { slug: "y", enabled: true, scope: "/proj/a" });
  assert.equal(cfg.skills.policy["/proj/a"].y, true);
  setSkillEnabled(cfg, { slug: "x", enabled: null });
  assert.equal(cfg.skills.policy.default, undefined); // scope removed when empty
});

test("annotateSkills reports enabled/private/overridden for the scope", () => {
  const cfg = { skills: { policy: { "/proj/a": { "apx-rag-demo": false } } } };
  const ann = annotateSkills([builtin, glob], { config: cfg, projectPath: "/proj/a" });
  assert.deepEqual(
    ann.map((s) => ({ slug: s.slug, enabled: s.enabled, priv: s.private, ov: s.overridden })),
    [
      { slug: "apx", enabled: true, priv: true, ov: false },
      { slug: "apx-rag-demo", enabled: false, priv: false, ov: true },
    ],
  );
});

test("resolveScopeKey normalizes empty/blank to default", () => {
  assert.equal(resolveScopeKey(undefined), "default");
  assert.equal(resolveScopeKey("  "), "default");
  assert.equal(resolveScopeKey("/proj/a"), "/proj/a");
});

// A project-scoped fixture skill: non-private, so it can be toggled. Uses a
// temp dir so the test never depends on machine-specific global skills.
const FIXTURE_SLUG = `apx-policy-test-${process.pid}`;

function withFixtureProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-policy-"));
  const skillDir = path.join(dir, ".apc", "skills", FIXTURE_SLUG);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${FIXTURE_SLUG}\ndescription: fixture policy skill\n---\n\n# body\n`,
  );
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("list_skills tool hides a disabled project skill; keeps private built-ins", () => {
  withFixtureProject((projectPath) => {
    const cfg = {
      skills: { policy: { [projectPath]: { [FIXTURE_SLUG]: false }, default: { apx: false } } },
    };
    const handler = listSkillsTool.makeHandler({ globalConfig: cfg });
    const out = handler({ project_path: projectPath });
    assert.ok(out.ok);
    assert.ok(out.skills.some((s) => s.slug === "apx"), "private apx must remain listed");
    assert.ok(
      !out.skills.some((s) => s.slug === FIXTURE_SLUG),
      "disabled project skill must be hidden",
    );
  });
});

test("load_skill tool refuses a disabled skill; private ones always load", () => {
  withFixtureProject((projectPath) => {
    const cfg = { skills: { policy: { [projectPath]: { [FIXTURE_SLUG]: false } } } };
    const handler = loadSkillTool.makeHandler({ globalConfig: cfg });
    assert.throws(
      () => handler({ slug: FIXTURE_SLUG, project_path: projectPath }),
      /disabled/i,
    );
    // Enabled (no override) → loads fine.
    const open = loadSkillTool.makeHandler({ globalConfig: {} });
    assert.equal(open({ slug: FIXTURE_SLUG, project_path: projectPath }).slug, FIXTURE_SLUG);
  });

  // A private skill still loads even if someone tries to disable it.
  const priv = loadSkillTool.makeHandler({
    globalConfig: { skills: { policy: { default: { apx: false } } } },
  });
  assert.equal(priv({ slug: "apx" }).slug, "apx");
});
