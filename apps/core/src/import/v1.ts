// Read-only import from a local APX v1: registers the project folders it knows (each one's AGENTS.md and .apc/ are
// then read from disk, like any project) and, only when asked, copies its model API keys and its skills once into
// v2's own home. Never writes to v1; never sends the v1 token off this machine.
import fs from "node:fs";
import path from "node:path";
import type { ApcSync } from "../apc/sync.ts";
import type { Secrets } from "../secrets.ts";

type V1Project = { id: number; name: string; path: string; missing: boolean };

/** v1 config path → v2 secret name. */
const V1_KEYS: Record<string, string> = {
  "engines.gemini.api_key": "gemini",
  "engines.anthropic.api_key": "anthropic",
  "engines.openai.api_key": "openai",
};

function v1Value(config: unknown, dotted: string): string | undefined {
  let cur: unknown = config;
  for (const k of dotted.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[k];
  return typeof cur === "string" && cur ? cur : undefined;
}

const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Anything already at that name, a broken link included, is the owner's and stays. */
const taken = (p: string) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Copies v1's skills into `to` once: a folder is copied without the links inside it; a skill that was itself a link
 * stays a link to the same place. A name v2 already has is left alone.
 */
export function importSkills(from: string, to: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(from);
  } catch {
    return [];
  }
  fs.mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of names.sort()) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (!SKILL_NAME.test(name) || taken(dst)) continue;
    try {
      if (!fs.existsSync(path.join(src, "SKILL.md"))) continue;
      if (fs.lstatSync(src).isSymbolicLink()) fs.symlinkSync(fs.realpathSync(src), dst);
      else
        fs.cpSync(src, dst, {
          recursive: true,
          filter: (f) => !fs.lstatSync(f).isSymbolicLink() && path.basename(f) !== ".DS_Store",
        });
      copied.push(name);
    } catch {
      fs.rmSync(dst, { recursive: true, force: true });
    }
  }
  return copied;
}

export async function importFromV1(
  apc: ApcSync,
  secrets: Secrets,
  opts: { url: string; home: string; v2Home: string; keys: boolean; skills: boolean; fetchImpl?: typeof fetch },
) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(opts.url).hostname))
    throw new Error("v1 import only talks to a local daemon");
  const skills = opts.skills ? importSkills(path.join(opts.home, "skills"), path.join(opts.v2Home, "skills")) : [];
  const keys: string[] = [];
  if (opts.keys) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(opts.home, "config.json"), "utf8")) as unknown;
      for (const [from, name] of Object.entries(V1_KEYS)) {
        const value = v1Value(config, from);
        if (value && !secrets.has(`secret://${name}`)) {
          secrets.set(name, value);
          keys.push(name);
        }
      }
    } catch {}
  }
  let token = "";
  try {
    token = fs.readFileSync(path.join(opts.home, "daemon.token"), "utf8").trim();
  } catch {}
  const res = await (opts.fetchImpl ?? fetch)(`${opts.url}/api/projects`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`v1 /projects: HTTP ${res.status}`);
  const list = ((await res.json()) as V1Project[]).filter((p) => !p.missing && p.name !== "default");
  let projects = 0;
  let agents = 0;
  for (const p of list) {
    try {
      const r = apc.register(p.path);
      projects++;
      agents += r.agents;
    } catch {
      // A folder v1 lists but that is not an APC project (or not on disk now) is skipped.
    }
  }
  return { projects, agents, keys, skills };
}
