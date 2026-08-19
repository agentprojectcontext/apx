import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillOrigin, homeRel } from "#core/agent/skills/origin.js";

test("homeRel shortens paths under $HOME", () => {
  const home = "/Users/demo";
  assert.equal(homeRel("/Users/demo/foo/SKILL.md", home), "~/foo/SKILL.md");
  assert.equal(homeRel("/tmp/x", home), "/tmp/x");
});

test("a skill living under ~/.claude/skills is origin claude", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-origin-"));
  const file = path.join(home, ".claude", "skills", "framevox", "SKILL.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# hi\n");
  const out = skillOrigin(file, { source: "global", home });
  assert.equal(out.origin, "claude");
  assert.equal(out.origin_path, "~/.claude/skills/framevox/SKILL.md");
  fs.rmSync(home, { recursive: true, force: true });
});

test("an APX symlink into Claude reports origin claude and both paths", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-origin-link-"));
  const claude = path.join(home, ".claude", "skills", "framevox");
  const apx = path.join(home, ".apx", "skills", "framevox");
  fs.mkdirSync(claude, { recursive: true });
  fs.mkdirSync(path.dirname(apx), { recursive: true });
  fs.writeFileSync(path.join(claude, "SKILL.md"), "# hi\n");
  fs.symlinkSync(claude, apx);
  const file = path.join(apx, "SKILL.md");
  const out = skillOrigin(file, { source: "global", home });
  assert.equal(out.origin, "claude");
  assert.equal(out.origin_path, "~/.claude/skills/framevox/SKILL.md");
  assert.equal(out.file_path, "~/.apx/skills/framevox/SKILL.md");
  fs.rmSync(home, { recursive: true, force: true });
});

test("builtin stays origin apx; project stays project", () => {
  const home = "/Users/demo";
  assert.equal(skillOrigin("/opt/apx/skills/apx/SKILL.md", { source: "builtin", home }).origin, "apx");
  assert.equal(skillOrigin("/proj/.apc/skills/foo.md", { source: "project", home }).origin, "project");
});
