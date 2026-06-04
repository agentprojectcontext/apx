#!/usr/bin/env node
// Wire up .githooks/ as the git hooks path so the pre-push gate runs
// without each contributor having to remember `git config core.hooksPath`.
//
// Runs from the `prepare` lifecycle (npm/pnpm fires `prepare` after a fresh
// install in a repo clone). Silently skips when there's no .git/ — i.e. when
// users install the published package globally, the hook setup is irrelevant.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

if (!fs.existsSync(path.join(REPO_ROOT, ".git"))) {
  // Probably an installed copy in node_modules / global pnpm. Nothing to do.
  process.exit(0);
}

try {
  execSync("git config core.hooksPath .githooks", {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  console.log("install-githooks: git hooks path set to .githooks ✓");
} catch (e) {
  console.warn(`install-githooks: could not configure git hooks (${e.message}); pre-push gate disabled until you run \`git config core.hooksPath .githooks\` manually`);
}
