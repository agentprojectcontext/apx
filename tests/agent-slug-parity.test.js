// The slug an agent name yields, computed twice: by core
// (core/apc/agent-write.js — the rename route and the rename_agent tool) and by
// the web panel (lib/slug.ts — the New agent dialog fills the Slug field from
// the Name as you type). The panel is a separate package and cannot import
// core, so the logic is mirrored; this test is what keeps the mirror honest.
//
// The bug it guards: the dialog left the slug empty after typing "Vera" and
// Create answered with a raw regex. A slug the dialog derives must be one the
// daemon accepts.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-agent-slug-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { agentSlugFromName, AGENT_SLUG_RE } = await import("#core/apc/agent-write.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = await import(path.join(ROOT, "src/interfaces/web/src/lib/slug.ts"));

const CASES = [
  ["Vera", "vera"],
  ["Lucía", "lucia"],
  ["Ñaña Pérez", "nana-perez"],
  ["  Code Reviewer  ", "code-reviewer"],
  ["R&D / Labs", "r-d-labs"],
  ["3PO", "po"],
  ["42 Agent", "agent"],
  ["-_-Ops", "ops"],
  ["123", ""],
  ["", ""],
  ["🤖", ""],
];

test("core derives a valid agent slug from a name, or nothing", () => {
  for (const [name, want] of CASES) {
    const got = agentSlugFromName(name);
    assert.equal(got, want, `name ${JSON.stringify(name)}`);
    if (got) assert.ok(AGENT_SLUG_RE.test(got), `${got} must be a valid slug`);
  }
});

test("the web panel derives the same slug as core", () => {
  for (const [name] of CASES) {
    assert.equal(web.agentSlugFromName(name), agentSlugFromName(name), `name ${JSON.stringify(name)}`);
  }
  assert.equal(String(web.AGENT_SLUG_RE), String(AGENT_SLUG_RE));
});

test("the slug error is a sentence, not a regex, in both languages", () => {
  for (const lang of ["en", "es"]) {
    const src = fs.readFileSync(path.join(ROOT, `src/interfaces/web/src/i18n/${lang}.ts`), "utf8");
    for (const key of ["slug_invalid", "slug_required"]) {
      const m = src.match(new RegExp(`\\n\\s+${key}:\\s*"([^"]*)"`));
      assert.ok(m, `${lang}.ts is missing project.agents.${key}`);
      assert.doesNotMatch(m[1], /[\\/^$]/, `${lang}.ts ${key} still reads like a regex: ${m[1]}`);
      assert.match(m[1], /^[A-ZÁÉÍÓÚÑ]/, `${lang}.ts ${key} must start with a capital`);
    }
  }
});
