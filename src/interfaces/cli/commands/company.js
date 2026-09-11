// `apx company` — the executive layer of a company project.
//
// Two commands, and they are the two halves of a routine: `context` builds the
// volatile block the agent reads, `handoff` decides what happens to the brief
// it wrote. Both are meant to be called by the `company` profile's routines
// rather than by a person, but both are useful by hand when something looks
// wrong — `handoff --dry-run` in particular answers "what WOULD happen" without
// spending one of the week's interruptions.
import fs from "node:fs";
import path from "node:path";

import { buildContext, extractSources, handoff, policyFrom, RITUALS, listSources } from "#core/company/index.js";
import { readProjectProfileState, projectProfileSettings, projectRoutineStorage } from "#core/profiles/project.js";
import { readConfig } from "#core/config/index.js";
import { resolveProjectRoot } from "./project.js";

const c = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", gray: "\x1b[90m" };
const dim = (s) => `${c.dim}${s}${c.reset}`;
const bold = (s) => `${c.bold}${s}${c.reset}`;
const cyan = (s) => `${c.cyan}${s}${c.reset}`;
const gray = (s) => `${c.gray}${s}${c.reset}`;

async function resolveCompany(args) {
  const root = await resolveProjectRoot(args.flags.project);
  const { active } = readProjectProfileState(root);
  if (!active) {
    throw new Error(
      "this project runs no profile — activate one with `apx profile use company --project <name>`",
    );
  }
  const settings = projectProfileSettings(root, active);
  const meta = JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"));
  return {
    project: { path: root, name: meta.name || path.basename(root), storagePath: projectRoutineStorage({ path: root }) },
    policy: policyFrom(settings),
  };
}

function ritualOf(args) {
  const ritual = args.flags.ritual;
  if (!ritual || !RITUALS[ritual]) {
    throw new Error(`--ritual is required — one of: ${Object.keys(RITUALS).join(", ")}`);
  }
  return ritual;
}

/**
 * The super-agent's name, read from APX's own config: renaming it must not
 * silently turn the handoff into a message filed under a correspondent nobody
 * can place.
 */
function orchestratorName() {
  try {
    const name = readConfig()?.super_agent?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // A missing config is not a reason to invent a recipient.
  }
  return "apx";
}

export async function cmdCompanyContext(args) {
  const { project, policy } = await resolveCompany(args);
  const ritual = ritualOf(args);
  // The business numbers are a monthly question. Asking for them daily spends
  // a minute of spawn time answering something nobody asked.
  const only = args.flags.only ? String(args.flags.only).split(",").map((s) => s.trim()) : null;
  const out = buildContext({ ritual, project, policy, only });
  process.stdout.write(`${out.text}\n`);
}

export async function cmdCompanyHandoff(args) {
  const { project, policy } = await resolveCompany(args);
  const ritual = ritualOf(args);

  // The routine hands the model's answer in APX_LLM_OUTPUT and the pre-command's
  // block in APX_PRE_OUTPUT. By hand, the brief comes on stdin.
  const brief = process.env.APX_LLM_OUTPUT ?? readStdin();
  if (!brief || !brief.trim()) throw new Error("no brief to hand off (APX_LLM_OUTPUT is empty and stdin was too)");

  const out = handoff({
    brief,
    ritual,
    project,
    policy,
    orchestrator: orchestratorName(),
    sources: extractSources(process.env.APX_PRE_OUTPUT),
    dryRun: !!args.flags["dry-run"],
  });

  const tone = { send: cyan, hold: gray, drop: gray, rejected: bold, failed: bold }[out.action] || gray;
  process.stderr.write(`  ${tone(out.action)} ${dim(out.reason)}\n`);
  if (out.findings?.length) {
    for (const f of out.findings) process.stderr.write(`    ${gray(f.rule)}: ${f.message}\n`);
  }
  // The action is the answer, and a non-delivery is not a failure: a quiet week
  // is the expected outcome most days.
  process.stdout.write(`${out.action}\n`);
}

export async function cmdCompanySources(args) {
  const { project } = await resolveCompany(args);
  const sources = listSources(project.storagePath);
  if (!sources.length) {
    console.log(dim("  no sources yet — a source is an artifact named `source-<name>` that prints a block"));
    console.log(dim(`  create one:  apx artifact create source-board.sh --project ${project.name}`));
    return;
  }
  for (const s of sources) console.log(`  ${bold(s.name.padEnd(16))} ${gray(s.file)}`);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
