// Keeps the core's index in step with the projects' files: on register, on start, on request and while running
// (a watcher on each project's .apc/). Files are the truth; the database is the index the rest of the core reads.
import fs from "node:fs";
import path from "node:path";
import type { ModelChoice } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import { textField } from "./frontmatter.ts";
import { type ApcAgent, isApcProject, readAgents, readProject } from "./read.ts";

const DEBOUNCE_MS = 400;

export const projectIdOf = (apcId: string) => `p_${apcId}`;
export const agentIdOf = (apcId: string, slug: string) => `${apcId}-${slug}`.toLowerCase();

/**
 * v1 wrote "provider:model". Only an engine this install knows becomes a choice; "inherit", a bare id or v1-only
 * engines ("chatgpt-codex:…@medium") say nothing we can run, so the agent keeps the install default.
 */
function choiceFromV1(model: string | undefined, engines: { has(id: string): boolean }): ModelChoice | undefined {
  const m = model?.trim();
  if (!m || m === "inherit" || !m.includes(":")) return undefined;
  const [engine = "", ...rest] = m.split(":");
  const id = rest.join(":");
  if (!engines.has(engine) || !id || /[@\s]/.test(id)) return undefined;
  return { model: `${engine}/${id}`, router: true };
}

export type SyncResult = { project: string; agents: number; archived: number };

export function createApcSync(deps: { store: Store; log: Log; engines: { has(id: string): boolean } }) {
  const { store, log } = deps;
  const watchers = new Map<string, fs.FSWatcher[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** An id for a new file's agent: the natural one unless another agent (e.g. a renamed one) already holds it. */
  function freshId(base: string, slug: string, used: string[]): string {
    const free = (id: string) => !used.includes(id) && (store.agents.get(id)?.slug ?? slug) === slug;
    if (free(base)) return base;
    for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
  }

  function syncRoot(root: string): SyncResult {
    const abs = path.resolve(root);
    const p = readProject(abs);
    // A clone or worktree carries the same committed apx_id: while the first folder is still there, this one is a
    // different project (its own id from its path), not a replacement.
    const holder = store.projects.get(projectIdOf(p.id));
    const taken = holder?.path && holder.path !== abs && fs.existsSync(holder.path);
    const apcId = taken ? p.pathId : p.id;
    const projectId = projectIdOf(apcId);
    const agents: ApcAgent[] = readAgents(abs);
    const present = new Set(agents.map((a) => a.slug));
    return store.tx(() => {
      store.projects.upsert({
        id: projectId,
        name: p.name,
        path: abs,
        ...(p.description ? { description: p.description } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.context ? { context: p.context } : {}),
        ...(p.memory ? { memory: p.memory } : {}),
        present: true,
      });
      const ids: string[] = [];
      for (const a of agents) {
        // A renamed file keeps its agent (and every thread that points at it); one agent per file.
        const found = store.agents.forFile(projectId, a.slug, a.aliases, present)?.id;
        const id = found && !ids.includes(found) ? found : freshId(agentIdOf(apcId, a.slug), a.slug, ids);
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
          model_choice: choiceFromV1(a.model, deps.engines),
          extra: {
            skills: a.skills,
            tools: a.tools,
            aliases: a.aliases,
            emoji: a.emoji,
            autonomy: textField(a.fields.autonomy ?? a.fields.Autonomy),
          },
        });
      }
      return { project: projectId, agents: agents.length, archived: store.agents.archiveMissing(projectId, ids) };
    });
  }

  /** Watches .apc/ (recursively) and the project folder itself for AGENTS.md; changes reindex, debounced. */
  function watch(root: string): void {
    if (watchers.has(root)) return;
    const changed = () => {
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
    };
    const list: fs.FSWatcher[] = [];
    try {
      if (fs.existsSync(path.join(root, ".apc")))
        list.push(fs.watch(path.join(root, ".apc"), { recursive: true }, changed));
      list.push(fs.watch(root, (_e, file) => file === "AGENTS.md" && changed()));
    } catch {}
    for (const w of list) w.on("error", () => w.close());
    watchers.set(root, list);
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
      for (const list of watchers.values()) for (const w of list) w.close();
      for (const t of timers.values()) clearTimeout(t);
      watchers.clear();
    },
  };
}

export type ApcSync = ReturnType<typeof createApcSync>;
