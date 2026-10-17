// A project's areas and roles: `.apc/organization.json`, the same file APX v1 wrote. Read leniently (v1 wrote nulls,
// a hand edit may break one entry): an entry that does not fit is skipped, not the whole file.
import fs from "node:fs";
import path from "node:path";
import { OrgArea, type Organization, OrgRole } from "@apx/protocol";
import { writeAtomic } from "../paths.ts";
import { withoutBom } from "./read.ts";

export const EMPTY_ORG: Organization = { areas: [], roles: [] };

const orgFile = (root: string) => path.join(root, ".apc", "organization.json");
const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Drops nulls (v1's "no goal") so the optional fields read as absent. */
const clean = (x: unknown) =>
  x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null)) : x;

export function readOrganization(root: string): Organization {
  let raw: { areas?: unknown; roles?: unknown };
  try {
    raw = JSON.parse(withoutBom(fs.readFileSync(orgFile(root), "utf8"))) as typeof raw;
  } catch {
    return EMPTY_ORG;
  }
  const each = <T>(list: unknown, schema: { safeParse(x: unknown): { success: boolean; data?: T } }) =>
    (Array.isArray(list) ? list : []).flatMap((x) => {
      const r = schema.safeParse(clean(x));
      return r.success && r.data ? [r.data] : [];
    });
  return { areas: each(raw.areas, OrgArea).slice(0, 40), roles: each(raw.roles, OrgRole).slice(0, 200) };
}

export function writeOrganization(root: string, org: Organization): void {
  const dir = path.join(root, ".apc");
  for (const p of [dir, orgFile(root)])
    if (isLink(p)) throw new Error(`refusing to write through a symlink: ${path.relative(root, p)}`);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(orgFile(root), `${JSON.stringify(org, null, 2)}\n`);
}
