// Read-only import from a local APX v1: projects and agents from its daemon, and (only when asked) its model API
// keys copied once into v2's own secret store. Never writes to v1; never sends the v1 token off this machine.
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import type { Secrets } from "../secrets.ts";

type V1Project = { id: number; name: string; path: string; apx_id: string; missing: boolean };
type V1Agent = { slug: string; name?: string; role?: string; description?: string; blob?: string };

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
  store: Store,
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
  const f = opts.fetchImpl ?? fetch;
  let token = "";
  try {
    token = fs.readFileSync(path.join(opts.home, "daemon.token"), "utf8").trim();
  } catch {}
  const get = async <T>(p: string): Promise<T> => {
    const res = await f(`${opts.url}/api${p}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`v1 ${p}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  const projects = (await get<V1Project[]>("/projects")).filter((p) => !p.missing && p.name !== "default");
  let agents = 0;
  for (const p of projects) {
    const id = `p_${p.apx_id}`;
    store.projects.upsert({ id, name: p.name, path: p.path });
    const list = await get<V1Agent[]>(`/projects/${p.id}/agents`).catch(() => [] as V1Agent[]);
    for (const a of list) {
      const agentId = `${p.apx_id}-${a.slug}`.toLowerCase();
      if (store.agents.get(agentId)) continue;
      store.agents.upsert({
        id: agentId,
        name: a.name ?? a.slug,
        role: a.role ?? "",
        kind: "agent",
        ...(a.blob ? { blob: a.blob } : {}),
        project_id: id,
        browser_profile: "isolated",
        prompt: a.description ?? "",
      });
      agents++;
    }
  }
  return { projects: projects.length, agents, keys };
}
