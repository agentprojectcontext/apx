// Moving this APX to another computer, or keeping a copy: `apx export` writes the file, `apx import` shows what it
// would do and, with --yes, does it. Secrets never travel: the import lists the ones to fill here.
import fs from "node:fs";
import type { InstancePlan, InstancePlanItem } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const SECTIONS: Record<InstancePlanItem["section"], string> = {
  agents: "Agents",
  projects: "Projects",
  routines: "Routines",
  tables: "Tables",
  flows: "Flows",
  memory: "Memory notes",
  channels: "Channels",
  mcps: "MCP servers",
  providers: "Model APIs",
  settings: "Preferences",
  skills: "Skills",
  chats: "Chats",
};

const WHY: Record<NonNullable<InstancePlanItem["reason"]>, string> = {
  needs_secret: "arrives off until its key or sign-in is set here",
  changed: "arrives off: it changed, look at it before turning it on",
  runs_command: "arrives off: it runs a command on this computer",
  uses_key: "arrives off: it uses a key this computer has, check its address first",
  draft: "arrives off, as a draft to publish",
  folder_missing: "waits for its folder on this computer",
  agent_missing: "left out: its agent is not here",
  project_missing: "left out: its project is not here",
  kept_here: "left out: this computer keeps its own",
  home_not_empty: "left out: Home here already has messages",
  invalid: "left out: it could not be read",
};

export async function exportInstance(
  client: ApxClient,
  o: { out?: string | undefined; chats?: boolean | undefined; rows?: boolean | undefined },
): Promise<void> {
  const { file, name, bytes } = await client.call("instance.export", {
    chats: o.chats ?? false,
    rows: o.rows ?? false,
  });
  const out = o.out ?? name;
  fs.writeFileSync(out, JSON.stringify(file, null, 2), { mode: 0o600 });
  const kb = Math.max(1, Math.round(bytes / 1024));
  console.log(
    `${out}  ${kb} KB  ${file.agents.length} agents, ${file.projects.length} projects, ${file.flows.length} Flows`,
  );
  console.log("No secret values are in it: on the other computer, fill them in and turn things on.");
}

/** The preview as lines: counts by section, then what arrives off or is left out, then the secrets to fill. */
function planLines(plan: InstancePlan): string[] {
  const lines: string[] = [];
  for (const [section, label] of Object.entries(SECTIONS)) {
    const items = plan.items.filter((i) => i.section === section);
    if (!items.length) continue;
    const n = (a: InstancePlanItem["action"]) => items.filter((i) => i.action === a).length;
    const parts = [`${n("add")} new`, `${n("update")} changed`, `${n("same")} already here`];
    if (n("skip")) parts.push(`${n("skip")} left out`);
    lines.push(`${label.padEnd(14)} ${parts.join(", ")}`);
  }
  const noted = plan.items.filter((i) => i.reason && i.action !== "same");
  if (noted.length) lines.push("", ...noted.map((i) => `  ${i.label} — ${WHY[i.reason as keyof typeof WHY]}`));
  if (plan.secrets.length) lines.push("", `Secrets to fill here: ${plan.secrets.join(", ")}`);
  return lines;
}

export async function importInstance(client: ApxClient, path: string | undefined, o: { yes?: boolean | undefined }) {
  if (!path) throw new Error("usage: apx import <file.json> [--yes]");
  const file: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!o.yes) {
    const plan = await client.call("instance.preview_import", { file });
    console.log(`From APX ${plan.apx_version}, made ${plan.created_at.slice(0, 10)}`);
    for (const l of planLines(plan)) console.log(l);
    const changes = plan.items.filter((i) => i.action === "add" || i.action === "update").length;
    console.log(
      changes ? "\nNothing changed yet. Run again with --yes to import." : "\nEverything in it is already here.",
    );
    return;
  }
  const done = await client.call("instance.import", { file });
  for (const l of planLines(done)) console.log(l);
  console.log(done.applied ? `\nImported ${done.applied} items.` : "\nEverything in it was already here.");
}
