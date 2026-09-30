// Everything core reads from disk at run time has to be inside what npm
// publishes. The agent vault, its packs and the name pool lived in the repo's
// root `assets/`, which package.json `files` does not ship: every install from
// npm opened "Import from vault" to "No templates in the vault", while a dev
// checkout — where the folder exists — showed all twenty.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const shipped = pkg.files.filter((f) => !f.startsWith("!")).map((f) => f.replace(/\/$/, ""));
const isShipped = (abs) => {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  return shipped.some((f) => rel === f || rel.startsWith(`${f}/`));
};

test("the vault, its packs and the name pool ship in the npm package", async () => {
  const { BUNDLED_VAULT_DIR } = await import("#core/apc/parser.js");
  const { BUNDLED_PACKS_FILE } = await import("#core/apc/agent-packs.js");
  const { NAMES_FILE } = await import("#core/apc/agent-names.js");
  for (const p of [BUNDLED_VAULT_DIR, BUNDLED_PACKS_FILE, NAMES_FILE]) {
    assert.ok(fs.existsSync(p), `${p} exists`);
    assert.ok(isShipped(p), `${path.relative(ROOT, p)} is inside package.json "files"`);
  }
  assert.ok(fs.readdirSync(BUNDLED_VAULT_DIR).filter((f) => f.endsWith(".md")).length >= 10, "and the vault is not empty");
});

test("no core module reads from the unshipped root assets/ folder", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js") && /\.\.\/\.\.\/\.\.\/assets\b/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, "src", "core"));
  assert.deepEqual(offenders, []);
});
