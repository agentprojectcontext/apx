import fs from 'node:fs';
import path from 'node:path';
import { TOOL_SCHEMAS } from './src/daemon/super-agent-tools/index.js';
import { TOOL_DEFINITIONS } from './src/daemon/tools/registry.js';

const SRC = path.join(process.cwd(), 'src');

const estimateTokens = (bytes) => Math.ceil(bytes / 4);

const getStats = (filePath) => {
  if (!fs.existsSync(filePath)) return { bytes: 0, tokens: 0 };
  const bytes = fs.statSync(filePath).size;
  return { bytes, tokens: estimateTokens(bytes) };
};

const results = {};

// SYSTEM PROMPT PARTS
const systemJs = fs.readFileSync(path.join(SRC, 'core/agent-system.js'), 'utf8');
const actionRulesMatch = systemJs.match(/const ACTION_DISCIPLINE_RULES = `([\s\S]*?)`;/);
if (actionRulesMatch) {
  const actionRules = actionRulesMatch[1];
  results['System Prompt (Action Rules)'] = { bytes: Buffer.byteLength(actionRules, 'utf8') };
  results['System Prompt (Action Rules)'].tokens = estimateTokens(results['System Prompt (Action Rules)'].bytes);
}

// SKILLS
const skillsDir = path.join(SRC, 'core/runtime-skills');
const skills = fs.readdirSync(skillsDir);
results['Skills'] = {};
for (const skill of skills) {
  results['Skills'][skill] = getStats(path.join(skillsDir, skill));
}
results['Skills']['apc-context-skill.md'] = getStats(path.join(SRC, 'core/apc-context-skill.md'));
results['Skills']['apx-skill.md'] = getStats(path.join(SRC, 'core/apx-skill.md'));

// TOOLS (SUPER AGENT)
const saToolsStr = JSON.stringify(TOOL_SCHEMAS);
const saToolsBytes = Buffer.byteLength(saToolsStr, 'utf8');
results['Tools (Super Agent Roby)'] = { bytes: saToolsBytes, tokens: estimateTokens(saToolsBytes) };

// TOOLS (REGISTRY - DEFAULT)
const regToolsStr = JSON.stringify(TOOL_DEFINITIONS);
const regToolsBytes = Buffer.byteLength(regToolsStr, 'utf8');
results['Tools (Registry API)'] = { bytes: regToolsBytes, tokens: estimateTokens(regToolsBytes) };

console.log(JSON.stringify(results, null, 2));
