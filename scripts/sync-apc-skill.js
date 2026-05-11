#!/usr/bin/env node
// Refresh skills/apc-context/SKILL.md before publishing.
//
// APC is a living standard owned by the agentprojectcontext repo. The copy
// bundled inside the apx npm package is only a fallback for users who
// install offline; postinstall.js fetches a fresh copy at install time.
//
// This script runs on `npm prepack` so the tarball ships with the latest
// known good snapshot. Resolution order:
//   1. Sibling checkout at ../agentprojectcontext (monorepo case)
//   2. Sibling checkout at ../apc                 (legacy local path)
//   3. raw.githubusercontent.com/agentprojectcontext/agentprojectcontext@main
//
// Non-fatal: if all sources fail, the existing snapshot is kept so prepack
// never blocks publishing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEST = path.join(PACKAGE_ROOT, "skills", "apc-context", "SKILL.md");
const REMOTE =
  "https://raw.githubusercontent.com/agentprojectcontext/agentprojectcontext/main/skills/apc-context/SKILL.md";

const SIBLING_CANDIDATES = [
  path.resolve(PACKAGE_ROOT, "..", "agentprojectcontext", "skills", "apc-context", "SKILL.md"),
  path.resolve(PACKAGE_ROOT, "..", "apc", "skills", "apc-context", "SKILL.md"),
];

function looksValid(text) {
  return typeof text === "string"
    && text.startsWith("---")
    && /name:\s*apc-context/.test(text);
}

async function fromRemote() {
  const fetchImpl = globalThis.fetch || (await import("node-fetch")).default;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetchImpl(REMOTE, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let source = "unknown";
  let text = null;

  for (const candidate of SIBLING_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      const t = fs.readFileSync(candidate, "utf8");
      if (looksValid(t)) {
        text = t;
        source = candidate;
        break;
      }
    }
  }

  if (!text) {
    try {
      const t = await fromRemote();
      if (looksValid(t)) {
        text = t;
        source = REMOTE;
      }
    } catch {
      // ignored
    }
  }

  if (!text) {
    console.warn("sync-apc-skill: no source available — keeping existing snapshot");
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, text, "utf8");
  console.log(`sync-apc-skill: refreshed from ${source}`);
}

main().catch((err) => {
  console.warn(`sync-apc-skill: ${err?.message || err} — keeping existing snapshot`);
  process.exit(0);
});
