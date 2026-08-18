import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

// Regression for SURVEY-2026-08-17 findings 1.2/1.3: the Code module used to
// browse files by shelling out through the /run endpoint — CodeScreen even
// interpolated a user-controlled path into `cat "${path}"` (shell injection)
// and posted it to un-prefixed "/run", which the SPA fallback swallowed, so
// file-open was silently broken. Both surfaces must go through the sandboxed
// project-files API (lib/api/projectFiles.ts → /api/projects/:pid/fs/*).
// CodeTerminal is the one legitimate /api/run client: it IS a terminal.

const SCREEN = "src/interfaces/web/src/screens/modules/CodeScreen.tsx";
const TREE = "src/interfaces/web/src/components/code/CodeFileTree.tsx";
const TERMINAL = "src/interfaces/web/src/components/code/CodeTerminal.tsx";

test("CodeScreen opens files via ProjectFiles.read, not a shell command", () => {
  const src = read(SCREEN);
  assert.match(src, /ProjectFiles\.read\(/, "file-open must use the fs API");
  assert.doesNotMatch(src, /cat\s+"?\$\{/, "no path interpolation into a shell command");
  assert.doesNotMatch(src, /["'`]\/(api\/)?run["'`]/, "CodeScreen must not call the run endpoint");
});

test("CodeFileTree lists files via ProjectFiles.tree, not a find pipeline", () => {
  const src = read(TREE);
  assert.match(src, /ProjectFiles\.tree\(/, "tree must use the fs API");
  assert.doesNotMatch(src, /find \. -type f/, "no shelled find pipeline");
  assert.doesNotMatch(src, /["'`]\/(api\/)?run["'`]/, "CodeFileTree must not call the run endpoint");
});

test("CodeTerminal still talks to /api/run (it is the terminal)", () => {
  assert.match(read(TERMINAL), /["'`]\/api\/run["'`]/);
});
