// apx skills import: read a folder, .zip or git repository, show what it holds, and with --yes copy it into APX.
import fs from "node:fs";
import path from "node:path";
import type { SkillCandidate, SkillImportSource } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

export type ImportFlags = {
  project?: string | undefined;
  /** Candidate ids (or names), comma-separated: only these. */
  only?: string | undefined;
  replace?: boolean | undefined;
  yes?: boolean | undefined;
};

const USAGE = "usage: apx skills import <folder|file.zip|git url> [--project p] [--only a,b] [--replace] [--yes]";

/** What the argument names: a repository address, a .zip on this computer, or a folder (made absolute here). */
export function importSource(arg: string, cwd = process.cwd()): SkillImportSource {
  if (/^(https:\/\/|ssh:\/\/|\w[\w.-]*@\w[\w.-]*:)/.test(arg)) return { kind: "repo", url: arg };
  const file = path.resolve(cwd, arg);
  if (/\.zip$/i.test(arg) && fs.statSync(file, { throwIfNoEntry: false })?.isFile())
    return { kind: "zip", name: path.basename(file), data: fs.readFileSync(file).toString("base64") };
  return { kind: "folder", path: file };
}

const STATUS: Record<SkillCandidate["status"], string> = {
  new: "new",
  exists: "already there",
  reserved: "APX's own name",
  invalid: "invalid name",
};
const NOTE: Record<SkillCandidate["notes"][number]["kind"], string> = {
  scripts: "scripts an agent could run",
  app_only: "settings only another app reads",
  skipped: "left out",
};

export async function skillsImport(client: ApxClient, arg: string | undefined, o: ImportFlags): Promise<void> {
  if (!arg) throw new Error(USAGE);
  const source = importSource(arg);
  const where = {
    target: o.project ? ("project" as const) : ("global" as const),
    ...(o.project ? { project: o.project } : {}),
  };
  const { candidates } = await client.call("skills.preview", { source, ...where });
  for (const c of candidates) {
    console.log(`${c.id.padEnd(32)} ${c.name.padEnd(28)} ${STATUS[c.status].padEnd(15)} ${c.files.length} files`);
    for (const n of c.notes) console.log(`${"".padEnd(33)}${NOTE[n.kind]}: ${n.items.join(", ")}`);
  }
  const only = o.only ? new Set(o.only.split(",").map((s) => s.trim())) : undefined;
  const pick = candidates
    .filter((c) =>
      only ? only.has(c.id) || only.has(c.name) : c.status === "new" || (o.replace && c.status === "exists"),
    )
    .map((c) => c.id);
  if (!o.yes) {
    console.log(
      pick.length
        ? `\nNothing copied yet (nothing in it runs). Add --yes to import ${pick.length}${o.only ? "" : " (choose with --only)"}.`
        : "\nNothing to import: every skill there is already in APX (--replace to overwrite) or cannot be used.",
    );
    return;
  }
  if (!pick.length) throw new Error("nothing to import (see the list above)");
  const r = await client.call("skills.import", { source, ...where, pick, replace: Boolean(o.replace) });
  for (const s of r.imported) console.log(`imported ${s.name} · ${s.path}`);
  for (const s of r.skipped) console.log(`skipped ${s.id}: ${s.reason}`);
}
