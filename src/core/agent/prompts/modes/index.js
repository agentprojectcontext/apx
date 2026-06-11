// Mode-specific system-prompt fragments for the Code module (plan / build).
// Each mode lives in its own .md sibling and is loaded once at boot.
//
// Why .md files instead of inline strings: the prompts are content, not code.
// Editing prompt copy shouldn't require touching code, and reviewing changes
// to behavior should be a doc-shaped diff, not a JS-shaped one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8").trim();
}

const CODE_PLAN_GUIDANCE  = load("code-plan.md");
const CODE_BUILD_GUIDANCE = load("code-build.md");

/**
 * Return the system-prompt fragment that explains how this mode behaves to
 * the agent. Falls back to BUILD when the mode is missing or unknown — build
 * is the safer default for the Code module (no mid-edit "do nothing" stall).
 */
export function codeModeGuidance(mode) {
  return mode === "plan" ? CODE_PLAN_GUIDANCE : CODE_BUILD_GUIDANCE;
}
