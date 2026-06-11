#!/usr/bin/env node
import { refreshApcContextSkill } from "../src/core/apc/skill-sync.js";

const result = await refreshApcContextSkill();
if (!result.ok) {
  console.warn(`sync-apc-skill: ${result.reason} — npm pack may ship without apc-context`);
  process.exit(0);
}
console.log(`sync-apc-skill: ${result.refreshed ? "refreshed" : "kept"} from ${result.source}`);
