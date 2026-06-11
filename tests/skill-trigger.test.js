// Unit tests for the `/slug` interface trigger that loads a skill body into
// the next turn's contextNote. The handler lives in
// src/host/daemon/skill-trigger.js and is wired into the HTTP super-agent
// stream endpoint; other interfaces (CLI, telegram, desktop) can call it
// directly to get the same shortcut.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tryResolveSkillCommand } from "#host/daemon/skill-trigger.js";

function withTempProjectSkill(slug, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-"));
  const apcSkills = path.join(dir, ".apc", "skills");
  fs.mkdirSync(apcSkills, { recursive: true });
  fs.writeFileSync(path.join(apcSkills, `${slug}.md`), body);
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("no slash prefix → handled:false (pass-through)", () => {
  const r = tryResolveSkillCommand("hello there");
  assert.equal(r.handled, false);
});

test("unknown slug → handled:false (caller decides)", () => {
  const r = tryResolveSkillCommand("/does-not-exist tell me more");
  assert.equal(r.handled, false);
});

test("known project-scoped slug → handled:true, body inlined", () => {
  withTempProjectSkill("test-skill", "# Body\nExact syntax here.", (projectPath) => {
    const r = tryResolveSkillCommand("/test-skill how do I X?", { projectPath });
    assert.equal(r.handled, true);
    assert.equal(r.skill.slug, "test-skill");
    assert.equal(r.prompt, "how do I X?");
    assert.match(r.contextNote, /Skill loaded on demand/);
    assert.match(r.contextNote, /Exact syntax here\./);
  });
});

test("slug-only message → prompt becomes a generic 'use the X skill' instruction", () => {
  withTempProjectSkill("hello", "# Hello skill body", (projectPath) => {
    const r = tryResolveSkillCommand("/hello", { projectPath });
    assert.equal(r.handled, true);
    assert.match(r.prompt, /Use the \*\*hello\*\* skill/);
  });
});

test("leading whitespace before the slash is tolerated", () => {
  withTempProjectSkill("trim-test", "## body", (projectPath) => {
    const r = tryResolveSkillCommand("   /trim-test rest of message", { projectPath });
    assert.equal(r.handled, true);
    assert.equal(r.prompt, "rest of message");
  });
});

test("slug match is case-insensitive", () => {
  withTempProjectSkill("case-test", "## body", (projectPath) => {
    const r = tryResolveSkillCommand("/Case-Test do X", { projectPath });
    assert.equal(r.handled, true);
    assert.equal(r.skill.slug, "case-test");
  });
});

test("non-string message → handled:false (safe for callers passing odd shapes)", () => {
  assert.equal(tryResolveSkillCommand(null).handled, false);
  assert.equal(tryResolveSkillCommand(undefined).handled, false);
  assert.equal(tryResolveSkillCommand(42).handled, false);
});
