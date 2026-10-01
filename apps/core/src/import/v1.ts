// Read-only import from a running APX v1 daemon: projects and their agents. Never writes to v1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../domain/store.ts";

type V1Project = { id: number; name: string; path: string; apx_id: string; missing: boolean };
type V1Agent = { slug: string; name?: string; role?: string; description?: string; blob?: string };

export async function importFromV1(store: Store, opts: { url?: string; fetchImpl?: typeof fetch } = {}) {
  const url = opts.url ?? "http://127.0.0.1:7430";
  const f = opts.fetchImpl ?? fetch;
  let token = "";
  try {
    token = fs.readFileSync(path.join(os.homedir(), ".apx", "daemon.token"), "utf8").trim();
  } catch {}
  const get = async <T>(p: string): Promise<T> => {
    const res = await f(`${url}/api${p}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`v1 ${p}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  const projects = await get<V1Project[]>("/projects");
  let agents = 0;
  for (const p of projects) {
    if (p.missing || p.name === "default") continue;
    const id = `p_${p.apx_id}`;
    store.upsertProject({ id, name: p.name, path: p.path });
    const list = await get<V1Agent[]>(`/projects/${p.id}/agents`).catch(() => [] as V1Agent[]);
    for (const a of list) {
      const agentId = `${p.apx_id}-${a.slug}`.toLowerCase();
      if (store.agent(agentId)) continue;
      store.upsertAgent({
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
  return { projects: projects.filter((p) => !p.missing && p.name !== "default").length, agents };
}
