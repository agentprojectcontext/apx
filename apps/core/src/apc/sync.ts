// Keeps the core's index in step with the projects' files: on register, on start, on request and while running
// (a watcher on each project's .apc/). Files are the truth; the database is the index the rest of the core reads.
import fs from "node:fs";
import path from "node:path";
import type { ModelChoice } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import { listField, textField } from "./frontmatter.ts";
import type { ProjectFiles, ReadProjectFiles } from "./project-reader.ts";
import { type ApcAgent, type ApcProject, isApcProject, readAgents, readProject } from "./read.ts";

/**
 * An agent file's `autonomy:`, with the names files written before the five modes used (DECISIONS.md#d-106): a file in
 * someone's repository is not APX's to rewrite, and reading `ask` as the default would let that agent act unasked.
 */
const FILE_MODES: Record<string, string> = {
  ask: "manual",
  standard: "auto",
  edits: "auto",
  "accept edits": "accept_edits",
};
const modeOfFile = (v: string | undefined) => (v === undefined ? v : (FILE_MODES[v.trim().toLowerCase()] ?? v));

const DEBOUNCE_MS = 400;
/** How long a project folder has to answer at start before it shows as waiting (rule 9). */
export const PROJECT_READ_MS = 5_000;

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

/** A timer the load's deadline runs on: the engine's run timers, so a test moves it by hand. */
type Timers = { after(ms: number, callback: () => void): () => void };
const realTimers: Timers = {
  after(ms, callback) {
    const t = setTimeout(callback, ms);
    return () => clearTimeout(t);
  },
};

export function createApcSync(deps: {
  store: Store;
  log: Log;
  engines: { has(id: string): boolean };
  /** Where `load` reads folders: worker threads in the core, a stand-in in tests. */
  read?: ReadProjectFiles;
  timers?: Timers;
  readMs?: number;
}) {
  const { store, log } = deps;
  const watchers = new Map<string, fs.FSWatcher[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // A folder still being read is not read a second time: one held read holds one thread.
  const reading = new Map<string, Promise<ProjectFiles>>();
  // Each start-up read still inside its deadline; closing ends them.
  const waits = new Set<() => void>();
  let closed = false;

  /** An id for a new file's agent: the natural one unless another agent (e.g. a renamed one) already holds it. */
  function freshId(base: string, slug: string, used: string[]): string {
    const free = (id: string) => !used.includes(id) && (store.agents.get(id)?.slug ?? slug) === slug;
    if (free(base)) return base;
    for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
  }

  function syncRoot(root: string): SyncResult {
    const abs = path.resolve(root);
    return apply(abs, readProject(abs), readAgents(abs));
  }

  function apply(abs: string, p: ApcProject, agents: ApcAgent[]): SyncResult {
    // One folder is one project: the record registered here keeps its id, chats and tasks even when project.json's
    // apx_id changed (another tool rewrote it) or cannot be read. One removed from APX does not outrank the apx_id.
    const records = store.projects.atPath(abs);
    const indexed = records.find((r) => r.registered !== false) ?? (p.metaError ? records[0] : undefined);
    const duplicates = records.filter((r) => r !== indexed);
    // A clone or worktree carries the same committed apx_id: while the first folder is still there, this one is a
    // different project (its own id from its path), not a replacement.
    const holder = indexed ? undefined : store.projects.get(projectIdOf(p.id));
    const taken = holder?.path && holder.path !== abs && fs.existsSync(holder.path);
    const apcId = indexed ? indexed.id.replace(/^p_/, "") : taken ? p.pathId : p.id;
    const projectId = indexed?.id ?? projectIdOf(apcId);
    // An unreadable project.json says nothing about the name or kind: keep what the index knew.
    const meta = p.metaError && indexed ? indexed : p;
    if (p.metaError) log.warn({ root: abs, err: p.metaError }, "could not read .apc/project.json");
    const present = new Set(agents.map((a) => a.slug));
    return store.tx(() => {
      // A second record an earlier apx_id change left at this folder stops being listed, and its agents with it;
      // its chats and tasks stay.
      for (const d of duplicates)
        if (d.registered !== false && d.id !== projectId) {
          store.projects.unregister(d.id);
          store.agents.archiveMissing(d.id, []);
        }
      store.projects.upsert({
        id: projectId,
        name: meta.name,
        path: abs,
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.kind ? { kind: meta.kind } : {}),
        ...(p.context ? { context: p.context } : {}),
        ...(p.contextChars ? { context_chars: p.contextChars } : {}),
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
            autonomy: modeOfFile(textField(a.fields.autonomy ?? a.fields.Autonomy)),
            area: textField(a.fields.area ?? a.fields.Area),
            personality: textField(a.fields.personality ?? a.fields.Personality),
            orchestrator: textField(a.fields.orchestrator ?? a.fields.Orchestrator),
            rules: listField(a.fields.rules ?? a.fields.Rules),
          },
        });
      }
      store.projects.setUnreadable(projectId, undefined);
      return { project: projectId, agents: agents.length, archived: store.agents.archiveMissing(projectId, ids) };
    });
  }

  /** What one folder's read found, written to the index; the folder is watched once it was read. */
  function settle(id: string, root: string, files: ProjectFiles): SyncResult | undefined {
    if (files.state === "read") {
      const r = apply(root, files.project, files.agents);
      watch(root);
      return r;
    }
    store.projects.setPresent(id, false);
    store.projects.setUnreadable(id, files.state === "denied" ? "denied" : undefined);
    return undefined;
  }

  /** Reads one folder off the main thread; past the deadline it shows as waiting, and its answer still lands. */
  function loadOne(id: string, root: string): Promise<void> {
    const read = deps.read;
    if (!read) return Promise.resolve();
    let pending = reading.get(root);
    if (!pending) {
      pending = read(root);
      reading.set(root, pending);
      void pending
        .then((files) => {
          // Closed, or removed from APX while it was read: nothing to write.
          if (closed || store.projects.get(id)?.registered === false) return;
          const r = settle(id, root, files);
          if (r) log.info({ project: r.project, agents: r.agents }, "project read");
        })
        .catch((err) => closed || log.warn({ project: id, err: String(err) }, "could not read project"))
        .finally(() => reading.delete(root));
    }
    return new Promise<void>((resolve) => {
      const end = () => {
        cancel();
        waits.delete(end);
        resolve();
      };
      const cancel = (deps.timers ?? realTimers).after(deps.readMs ?? PROJECT_READ_MS, () => {
        if (!closed) {
          log.warn({ project: id, root }, "project folder did not answer; it shows as waiting until it does");
          store.projects.setPresent(id, false);
          store.projects.setUnreadable(id, "waiting");
        }
        end();
      });
      waits.add(end);
      void pending.then(end, end);
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
    /** Stop watching before changing the registry, including a queued reindex. Files remain untouched. */
    unregister(projectId: string): void {
      const project = store.projects.get(projectId);
      if (!project) return;
      if (project.path) {
        for (const watcher of watchers.get(project.path) ?? []) watcher.close();
        watchers.delete(project.path);
        clearTimeout(timers.get(project.path));
        timers.delete(project.path);
      }
      store.projects.unregister(projectId);
    },
    /** Re-reads one project, or every registered one. Missing folders are marked absent, not forgotten. */
    sync(projectId?: string): { projects: number; agents: number; archived: number } {
      const out = { projects: 0, agents: 0, archived: 0 };
      for (const p of store.projects.list()) {
        if (projectId && p.id !== projectId) continue;
        if (!p.path) continue;
        // A folder still being read off the main thread may be held by the system: that read settles it.
        if (reading.has(path.resolve(p.path))) continue;
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
    /**
     * Reads every registered project at start, each off the main thread with a deadline: a folder the system holds
     * (a macOS privacy prompt nobody answered) shows as waiting, and the core and every other project go on.
     */
    async load(): Promise<void> {
      // One after another, so one thread reads them all; until a folder is read, the index from the last start stands.
      for (const p of store.projects.list()) if (p.path) await loadOne(p.id, path.resolve(p.path));
    },
    close(): void {
      closed = true;
      for (const end of waits) end();
      for (const list of watchers.values()) for (const w of list) w.close();
      for (const t of timers.values()) clearTimeout(t);
      watchers.clear();
    },
  };
}

export type ApcSync = ReturnType<typeof createApcSync>;
