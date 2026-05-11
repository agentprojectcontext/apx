#!/usr/bin/env node
// Runs automatically after `npm install -g apx` and `npm update -g apx`.
//
// Two-step process:
//   1. Refresh the bundled `apc-context` skill from the canonical APC repo.
//      APC is a living standard — we always want the latest copy at install
//      time. If the network call fails, the bundled snapshot that ships
//      with the npm tarball is used.
//   2. Propagate APX + APC skills (+ runtime docs) into every global skill
//      directory (~/.claude/skills, ~/.cursor/skills, ~/.codex/skills,
//      ~/.agents/skills).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { installGlobalSkills } from "../core/scaffold.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const APC_SKILL_LOCAL = path.join(PACKAGE_ROOT, "skills", "apc-context", "SKILL.md");
const APC_SKILL_REMOTE =
  "https://raw.githubusercontent.com/agentprojectcontext/agentprojectcontext/main/skills/apc-context/SKILL.md";

async function refreshApcSkill() {
  if (process.env.APX_SKIP_SKILL_REFRESH) return { status: "skipped" };

  try {
    const fetchImpl = globalThis.fetch || (await import("node-fetch")).default;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);

    const res = await fetchImpl(APC_SKILL_REMOTE, { signal: ac.signal });
    clearTimeout(timer);

    if (!res.ok) return { status: "fallback", reason: `HTTP ${res.status}` };
    const text = await res.text();

    if (!text.startsWith("---") || !/name:\s*apc-context/.test(text)) {
      return { status: "fallback", reason: "remote payload not a SKILL.md" };
    }

    fs.mkdirSync(path.dirname(APC_SKILL_LOCAL), { recursive: true });
    fs.writeFileSync(APC_SKILL_LOCAL, text, "utf8");
    return { status: "refreshed" };
  } catch (err) {
    return { status: "fallback", reason: err?.message || String(err) };
  }
}

try {
  const refresh = await refreshApcSkill();

  const results = installGlobalSkills();
  if (results.length === 0) process.exit(0);

  const home = os.homedir();
  const bySkill = {};
  for (const r of results) {
    if (!bySkill[r.skill]) bySkill[r.skill] = [];
    bySkill[r.skill].push(r.dir.replace(home, "~"));
  }

  console.log("\napx: skills installed globally");
  for (const [skill, dirs] of Object.entries(bySkill)) {
    console.log(`  ${skill.padEnd(14)} → ${dirs.join(", ")}`);
  }
  if (refresh.status === "refreshed") {
    console.log("  apc-context refreshed from agentprojectcontext/agentprojectcontext@main");
  } else if (refresh.status === "fallback") {
    console.log(`  apc-context: using bundled snapshot (${refresh.reason})`);
  }
  console.log("");
} catch {
  // Non-fatal — don't break the install.
}
