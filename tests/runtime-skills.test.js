// The runtime skill set — the super-agent's own operational documentation.
//
// These are read from the package path on demand, so a broken one does not fail
// a build: it just quietly stops being loadable, and the agent loses the
// knowledge without anything saying so. Nothing checked them until now.
//
// AGENTS.md rule 12 puts operational detail in on-demand skills precisely so the
// always-on prompt stays lean, which makes the skill the ONLY place that
// knowledge lives. A skill with a broken header is knowledge deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "src/core/runtime-skills");

const slugs = fs.readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

function frontmatter(slug) {
  const text = fs.readFileSync(path.join(DIR, slug, "SKILL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2];
  }
  return { fields, body: m[2] };
}

test("there is a runtime skill set at all", () => {
  assert.ok(slugs.length > 5, `only found ${slugs.length} skills — did the directory move?`);
});

test("every skill has a SKILL.md with parseable frontmatter", () => {
  for (const slug of slugs) {
    const file = path.join(DIR, slug, "SKILL.md");
    assert.ok(fs.existsSync(file), `${slug} has no SKILL.md`);
    assert.ok(frontmatter(slug), `${slug}: frontmatter did not parse`);
  }
});

test("the declared name matches the directory, or the loader cannot find it", () => {
  // The loader keys on the DIRECTORY slug. A skill whose header disagrees is
  // reachable by one name and describes itself as another.
  for (const slug of slugs) {
    assert.equal(frontmatter(slug).fields.name, slug, `${slug}: name/dir mismatch`);
  }
});

test("every skill has a description — it is the only thing that makes it fire", () => {
  // Selection is by description (semantic match / triggers). No description
  // means the skill exists and is never loaded, which is worse than absent
  // because it looks present.
  for (const slug of slugs) {
    const d = frontmatter(slug).fields.description || "";
    assert.ok(d.length > 40, `${slug}: description too thin to match on (${d.length} chars)`);
  }
});

test("every skill has a body, not just a header", () => {
  for (const slug of slugs) {
    assert.ok(frontmatter(slug).body.trim().length > 200, `${slug}: body is a stub`);
  }
});

test("skills are English-only, including the ones about Spanish phrasing", () => {
  // The house rule: prompts and skills are English; Spanish is the UI layer.
  // Quoted user phrasings are the deliberate exception — a skill that teaches
  // the agent to catch "le dije a Ana" has to contain that string — so this
  // checks PROSE outside quotes and code.
  const spanishProse = /\b(?:el|la|los|las|un|una|para|porque|entonces|debe|siempre|nunca)\s+\w+/i;
  for (const slug of slugs) {
    const body = frontmatter(slug).body
      .replace(/```[\s\S]*?```/g, "")   // code blocks
      .replace(/`[^`]*`/g, "")           // inline code
      .replace(/["'“”][^"'“”\n]*["'“”]/g, ""); // quoted phrasings
    const lines = body.split("\n").filter((l) => spanishProse.test(l));
    assert.deepEqual(lines, [], `${slug}: Spanish prose outside quotes:\n  ${lines[0] || ""}`);
  }
});

// --------------------------------------------------------------------------
// the one just added — commitments had no skill, only two tool descriptions
// --------------------------------------------------------------------------

test("apx-commitment exists and teaches the distinction that justifies the type", async () => {
  const { listSkills, loadSkill } = await import("#core/agent/skills/loader.js");
  assert.ok(listSkills({ projectPath: ROOT }).some((s) => s.slug === "apx-commitment"));

  const fm = frontmatter("apx-commitment");
  const body = fm.body;

  // If it does not answer "task or commitment?", the agent will guess.
  assert.match(body, /is a named person waiting/i);
  // The three endings, and the one that carries the relationship.
  for (const verb of ["kept", "missed", "renegotiate"]) {
    assert.match(body, new RegExp(`\\b${verb}\\b`), `missing the ${verb} case`);
  }
  assert.match(body, /reopens rather than closing/i);
  // Loadable through the real loader, not just readable off disk.
  const loaded = loadSkill("apx-commitment", { projectPath: ROOT });
  assert.ok((loaded?.body || loaded?.text || "").length > 1000);
});

test("its triggers cover how a promise is actually said, in both languages", () => {
  // Recording happens mid-conversation or not at all, so the description has to
  // match the sentence the owner really utters.
  const d = frontmatter("apx-commitment").fields.description;
  for (const phrase of ["I told X", "le dije a X", "qué le debo", "promised"]) {
    assert.ok(d.includes(phrase), `triggers miss "${phrase}"`);
  }
});

test("it says plainly what NOT to do, like its sibling apx-task", () => {
  const body = frontmatter("apx-commitment").body;
  assert.match(body, /^##+ Don't/m, "every apx-* skill ends with the anti-patterns");
  // The rejected design, recorded so it is not re-proposed.
  assert.match(body, /Don't use tags on tasks for this/i);
});
