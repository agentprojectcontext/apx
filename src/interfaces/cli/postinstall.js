#!/usr/bin/env node
// Runs automatically after `npm install -g apx` and `npm update -g apx`.
import os from "node:os";
import { refreshApcContextSkill } from "../../core/apc/skill-sync.js";
import { installGlobalSkills } from "../../core/apc/scaffold.js";

try {
  const refresh = process.env.APX_SKIP_SKILL_REFRESH
    ? { ok: true, refreshed: false, reason: "skipped" }
    : await refreshApcContextSkill();

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
  if (refresh.refreshed) {
    console.log("  apc-context refreshed from agentprojectcontext/agentprojectcontext@main");
  } else if (refresh.reason === "no-source") {
    console.log("  apc-context: run from monorepo with ../apc or network for fresh copy");
  }
  console.log("");
} catch {
  // Non-fatal
}
