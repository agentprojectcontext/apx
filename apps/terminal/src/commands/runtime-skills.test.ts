import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { apply, plan, readSkills, runtimes, type Skill, sourceDir } from "./runtime-skills.ts";

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-skills-"));
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skills: Skill[] = [
  { name: "apx", files: { "SKILL.md": "---\nname: apx\n---\nnew\n" } },
  { name: "apc-context", files: { "SKILL.md": "---\nname: apc-context\n---\n", "notes/extra.md": "x" } },
];
const actions = (p: ReturnType<typeof plan>) => p.steps.map((s) => `${s.runtime.id}:${s.name}:${s.action}`).sort();

test("the shipped skills each have a SKILL.md with a matching name", () => {
  const shipped = readSkills(sourceDir());
  assert.deepEqual(
    shipped.map((s) => s.name),
    ["apc-context", "apx", "apx-extensions", "apx-mcp"],
  );
  for (const s of shipped) assert.match(s.files["SKILL.md"] ?? "", new RegExp(`^---\\nname: ${s.name}\\n`));
});

test("only installed runtimes are planned; CODEX_HOME moves Codex", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"));
  const codex = path.join(home, "elsewhere", "codex");
  fs.mkdirSync(codex, { recursive: true });
  const p = plan(skills, runtimes(home, { CODEX_HOME: codex }));
  assert.deepEqual(p.missing.map((r) => r.id).sort(), ["agents", "cursor"]);
  assert.deepEqual(actions(p), [
    "claude:apc-context:create",
    "claude:apx:create",
    "codex:apc-context:create",
    "codex:apx:create",
  ]);
  assert.ok(p.steps.some((s) => s.dir === path.join(codex, "skills", "apx")));
});

test("install creates, updates, removes retired APX skills and leaves every other skill alone", () => {
  const home = tmpHome();
  const dir = path.join(home, ".claude", "skills");
  write(path.join(dir, "apx", "SKILL.md"), "old v1 text");
  write(path.join(dir, "apx", "stale.md"), "from an older version");
  write(path.join(dir, "apx-runtime", "SKILL.md"), "retired");
  write(path.join(dir, "someone-else", "SKILL.md"), "not ours");
  const targets = runtimes(home).filter((r) => r.id === "claude");

  const first = plan(skills, targets);
  assert.deepEqual(actions(first), ["claude:apc-context:create", "claude:apx-runtime:remove", "claude:apx:update"]);
  apply(first, skills);

  assert.equal(fs.readFileSync(path.join(dir, "apx", "SKILL.md"), "utf8"), skills[0]?.files["SKILL.md"]);
  assert.ok(!fs.existsSync(path.join(dir, "apx", "stale.md")), "an APX skill folder becomes an exact copy");
  assert.equal(fs.readFileSync(path.join(dir, "apc-context", "notes", "extra.md"), "utf8"), "x");
  assert.ok(!fs.existsSync(path.join(dir, "apx-runtime")));
  assert.equal(fs.readFileSync(path.join(dir, "someone-else", "SKILL.md"), "utf8"), "not ours");

  assert.deepEqual(actions(plan(skills, targets)), ["claude:apc-context:unchanged", "claude:apx:unchanged"]);
});

test("a link in place of a skill is left alone; a retired one is unlinked without touching its target", () => {
  const home = tmpHome();
  const dir = path.join(home, ".agents", "skills");
  const target = path.join(home, "shared", "apx");
  write(path.join(target, "SKILL.md"), "someone's own");
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(target, path.join(dir, "apx"));
  fs.symlinkSync(target, path.join(dir, "apx-task"));
  const targets = runtimes(home).filter((r) => r.id === "agents");

  const p = plan(skills, targets);
  assert.deepEqual(actions(p), ["agents:apc-context:create", "agents:apx-task:remove", "agents:apx:skip-link"]);
  apply(p, skills);
  assert.ok(fs.lstatSync(path.join(dir, "apx")).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(dir, "apx-task")));
  assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), "someone's own");
});

test("a dry plan writes nothing", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".cursor"));
  plan(skills, runtimes(home));
  assert.ok(!fs.existsSync(path.join(home, ".cursor", "skills")));
});
