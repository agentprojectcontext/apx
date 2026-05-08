#!/usr/bin/env node
// Runs automatically after `npm install -g apx`.
// Installs APX + APC context skills to all global skill directories.
import { installGlobalSkills } from "../core/scaffold.js";
import os from "node:os";

try {
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
  console.log("");
} catch {
  // Non-fatal — don't break the install
}
