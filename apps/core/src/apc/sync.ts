// Keeps the core's index in step with the projects' files: on register, on start, on request and while running
// (a watcher on each project's .apc/). Files are the truth; the database is the index the rest of the core reads.
import fs from "node:fs";
import path from "node:path";
import type { ModelChoice } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import { type ApcAgent, isApcProject, readAgents, readProject } from "./read.ts";

const DEBOUNCE_MS = 400;

export const projectIdOf = (apcId: string) => `p_${apcId}`;
export const agentIdOf = (apcId: string, slug: string) => `${apcId}-${slug}`.toLowerCase();

/** v1 wrote "provider:model"; "inherit" or a bare id says nothing we can route. */
function choiceFromV1(model: string | undefined): ModelChoice | undefined {
  const m = model?.trim();
  if (!m || m === "inherit" || !m.includes(":")) return undefined;
  const [engine, ...rest] = m.split(":");
  return { model: `${engine}/${rest.join(":")}`, router: true };
}

export type SyncResult = { project: string; agents: number; archived: number };

export function createApcSync(deps: { store: Store; log: Log }) {
  const { store, log } = deps;
  const watchers = new Map<string, fs.FSWatcher>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function syncRoot(root: string): SyncResult {
    const abs = path.resolve(root);
    const p = readProject(abs);
    const projectId = projectIdOf(p.id);
    const agents: ApcAgent[] = readAgents(abs);
    return store.tx(() => {
      store.projects.upsert({
        id: projectId,
        name: p.name,
        path: abs,
        ...(p.description ? { description: p.description } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.context ? { context: p.context } : {}),
        present: true,
      });
      const ids: string[] = [];
      for (const a of agents) {
        // A renamed file keeps its agent (and every thread that points at it).
        const id = store.agents.forFile(projectId, a.slug, a.aliases)?.id ?? agentIdOf(p.id, a.slug);
        ids.push(id);
        store.agents.upsertApc({
          id,
          project_id: projectId,
          slug: a.slug,
          name: a.name,
          role: a.role,
          prompt: [a.description && !a.prompt.includes(a.description) ? a.description : "", a.prompt]
            .filter(Boolean)
            .join("\n\n"),
          description: a.description,
          parent: a.parent,
          blob: a.icon,
          model_choice: choiceFromV1(a.model),
          extra: { skills: a.skills, tools: a.tools, aliases: a.aliases, emoji: a.emoji },
        });
      }
      return { project: projectId, agents: agents.length, archived: store.agents.archiveMissing(projectId, ids) };
    });
  }

  function watch(root: string): void {
    const dir = path.join(root, ".apc");
    if (watchers.has(root) || !fs.existsSync(dir)) return;
    try {
      const w = fs.watch(dir, { recursive: true }, () => {
        clearTimeout(timers.get(root));
        timers.set(
          root,
          setTimeout(() => {
            try {
              const r = syncRoot(root);
              log.info({ project: r.project, agents: r.agents }, "project files changed; reindexed");
            } catch (err) {
              log.warn({ root, err: String(err) }, "could not reindex project");
            }
          }, DEBOUNCE_MS),
        );
      });
      w.on("error", () => watchers.delete(root));
      watchers.set(root, w);
    } catch {}
  }

  return {
    /** Registers a folder as a project (it must have .apc/ or AGENTS.md) and indexes it. */
    register(root: string): SyncResult {
      const abs = path.resolve(root);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`not a folder: ${abs}`);
      if (!isApcProject(abs)) throw new Error(`not an APC project (no .apc/ or AGENTS.md): ${abs}`);
      const r = syncRoot(abs);
      watch(abs);
      return r;
    },
    /** Re-reads one project, or every registered one. Missing folders are marked absent, not forgotten. */
    sync(projectId?: string): { projects: number; agents: number; archived: number } {
      const out = { projects: 0, agents: 0, archived: 0 };
      for (const p of store.projects.list()) {
        if (projectId && p.id !== projectId) continue;
        if (!p.path) continue;
        if (!fs.existsSync(p.path) || !isApcProject(p.path)) {
          store.projects.setPresent(p.id, false);
          continue;
        }
        try {
          const r = syncRoot(p.path);
          watch(p.path);
          out.projects++;
          out.agents += r.agents;
          out.archived += r.archived;
        } catch (err) {
          log.warn({ project: p.id, err: String(err) }, "could not read project");
        }
      }
      return out;
    },
    close(): void {
      for (const w of watchers.values()) w.close();
      for (const t of timers.values()) clearTimeout(t);
      watchers.clear();
    },
  };
}

export type ApcSync = ReturnType<typeof createApcSync>;
