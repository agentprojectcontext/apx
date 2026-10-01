// Read-only import from a local APX v1: registers the project folders it knows (each one's AGENTS.md and .apc/ are
// then read from disk, like any project) and, only when asked, copies its model API keys once into v2's secret
// store. Never writes to v1; never sends the v1 token off this machine.
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

export async function importFromV1(
  apc: ApcSync,
  secrets: Secrets,
  opts: { url: string; home: string; keys: boolean; fetchImpl?: typeof fetch },
) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(opts.url).hostname))
    throw new Error("v1 import only talks to a local daemon");
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
  return { projects, agents, keys };
}
