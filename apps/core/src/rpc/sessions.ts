// The owner's own Claude Code and Codex sessions: listed from where those CLIs keep them, gone on with in APX as an
// engine session (the engine itself, in the session's folder, resuming its own transcript), or brought in as a
// project whose chats agents take over (import, digest, adopt).
import fs from "node:fs";
import path from "node:path";
import type { ApcSync } from "../apc/sync.ts";
import { projectOrchestrator } from "../domain/agent-directory.ts";
import type { AuxAbout } from "../domain/aux-calls.ts";
import type { Store } from "../domain/store.ts";
import { summary } from "../domain/surfaces.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import { applyExtras } from "../import/apply-extras.ts";
import { digestChat } from "../import/native-digest.ts";
import { nativeExtras } from "../import/native-extras.ts";
import { importedThread, importSessions, nativeProjects } from "../import/native-import.ts";
import { type NativeHomes, nativeSession, nativeSessions, nativeTranscript } from "../import/native-sessions.ts";
import { pageAsWidget } from "../import/page-widget.ts";
import { isInside, samePath } from "../paths.ts";
import { createProject } from "./app.ts";
import type { InternalCall } from "./internal.ts";
import type { Handlers } from "./router.ts";

/** What bringing a project in needs beyond the store: where APX keeps files, projects, and the auxiliary model. */
export type SessionDeps = {
  home: string;
  apc: ApcSync;
  /** A long read on the models `agent` sends its turns to (the auxiliary one after them). */
  ask(agent: string, about: AuxAbout, system: string, user: string): Promise<string | undefined>;
  /** The router, for what an import brings besides chats (servers, notes, tasks, routines): the owner's own checks. */
  call: InternalCall;
};

/** What is copied into the APX chat so the owner sees where they left off (the engine has it all already). */
const SHOWN_TURNS = 40;
const TURN_CHARS = 8000;

/** The registered project whose folder holds `dir` (the deepest one), if any. */
function projectOf(store: Store, dir: string): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const p of store.projects.list()) {
    if (!p.path) continue;
    const root = path.resolve(p.path);
    if (path.isAbsolute(dir) && isInside(root, dir) && root.length > (best?.len ?? -1))
      best = { id: p.id, len: root.length };
  }
  return best?.id;
}

/** The registered project in exactly this folder. */
const projectAt = (store: Store, dir: string) =>
  store.projects.list().find((p) => p.path && path.resolve(p.path) === path.resolve(dir))?.id;

const pageName = (file: string) =>
  path
    .basename(file)
    .replace(/\.html?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "page";

export function sessionHandlers(store: Store, homes: NativeHomes, deps: SessionDeps) {
  const superAgent = () => store.agents.list().find((a) => a.kind === "secretary") ?? store.agents.list()[0];
  /** The project a folder brought in lands in: the one APX has there, else the folder made one (or, gone, a new one). */
  const projectFor = (cwd: string, name: string): string => {
    const known = projectAt(store, cwd);
    if (known) return known;
    if (!fs.existsSync(cwd)) return createProject(deps.apc, deps.home, { name }).project;
    // A folder that already is a project keeps its own name and files.
    if (fs.existsSync(path.join(cwd, ".apc", "project.json")))
      try {
        return deps.apc.register(cwd).project;
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    return createProject(deps.apc, deps.home, { name, path: cwd }).project;
  };
  const headOf = (projectId: string) =>
    projectOrchestrator(store.agents.list().filter((a) => a.project_id === projectId))?.agent;
  const imported = (thread: string) => {
    const t = store.threads.get(thread);
    if (!t) throw notFound(`thread ${thread}`);
    if (!store.threads.context(t.id).imported)
      throw badRequest(`${t.title} is not a chat brought from Claude Code or Codex`);
    return t;
  };
  return {
    "sessions.projects": ({ engine }) => ({
      projects: nativeProjects(homes, engine).map((g) => {
        const project_id = projectAt(store, g.cwd);
        return {
          name: g.name,
          cwd: g.cwd,
          ...(project_id ? { project_id } : {}),
          sessions: g.sessions.map(({ id, title, updated_at }) => {
            const thread = importedThread(store, engine, id);
            return { id, title, updated_at, ...(thread ? { thread } : {}) };
          }),
        };
      }),
    }),
    "sessions.import": async ({ engine, cwd, sessions, name, extras }) => {
      const group = nativeProjects(homes, engine).find((g) => path.resolve(g.cwd) === path.resolve(cwd));
      if (!group) throw notFound(`${engine} sessions in ${cwd}`);
      const picked = sessions ? group.sessions.filter((s) => sessions.includes(s.id)) : group.sessions;
      if (!picked.length) throw notFound(`those ${engine} sessions in ${cwd}`);
      const projectId = projectFor(group.cwd, name ?? group.name);
      const project = store.projects.get(projectId);
      if (!project) throw notFound(`project ${projectId}`);
      const owner = headOf(project.id) ?? superAgent();
      if (!owner) throw notFound("an agent to own the chats");
      // Oldest first, so the project's chat list ends with the newest on top.
      const ordered = [...picked].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      const r = importSessions(store, deps.home, {
        engine,
        sessions: ordered,
        codexHome: homes.codex,
        project_id: project.id,
        owner: owner.id,
      });
      const root = project.path ? path.resolve(project.path) : undefined;
      const brought = extras
        ? await applyExtras(store, deps.call, {
            engine,
            project_id: project.id,
            head: owner.id,
            extras: nativeExtras(homes, engine, group.cwd, picked),
            chatOf: (session) => {
              const t = store.threads.get(importedThread(store, engine, session) ?? "");
              return t ? { title: t.title, agent: t.agent_ids[0] ?? owner.id } : undefined;
            },
          })
        : undefined;
      return {
        project: { id: project.id, name: project.name },
        ...(brought ? { extras: brought } : {}),
        chats: r.chats,
        pages: root
          ? r.pages.filter((p) => isInside(root, p) && !samePath(root, p)).map((p) => path.relative(root, p))
          : [],
      };
    },
    "sessions.digest": async ({ thread, refresh }) => {
      const t = imported(thread);
      const had = store.threads.context(t.id).digest;
      if (had && !refresh) return { thread: t.id, title: t.title, digest: had.text, at: had.at };
      const about: AuxAbout = { purpose: "summary", thread_id: t.id, project_id: t.project_id };
      // The super-agent reads it to make the team: the chat goes only where its turns already go.
      const reader = superAgent()?.id ?? t.agent_ids[0] ?? "";
      const text = await digestChat(store.messages.list(t.id, 100_000), t.title, (system, user) =>
        deps.ask(reader, about, system, user),
      );
      if (!text)
        throw badRequest("no auxiliary model answered: pick one in Settings › Models (an API model, not a CLI)");
      const at = new Date().toISOString();
      store.threads.mergeContext(t.id, { digest: { text, at } });
      return { thread: t.id, title: t.title, digest: text, at };
    },
    "sessions.adopt": ({ thread, agent: ref }) => {
      const t = imported(thread);
      const agents = store.agents.list();
      const agent =
        store.agents.get(ref) ??
        agents.find(
          (a) => a.project_id === t.project_id && (a.slug === ref || a.name.toLowerCase() === ref.toLowerCase()),
        );
      if (!agent) throw notFound(`agent ${ref}`);
      if (agent.project_id && agent.project_id !== t.project_id)
        throw badRequest(`${agent.name} is in another project than ${t.title}`);
      const from = t.agent_ids[0];
      if (!from || from === agent.id) return t;
      return store.threads.handOver(t.id, from, agent.id);
    },
    "surfaces.import_page": ({ project_id, path: file, name, title, pinned }) => {
      const project = store.projects.get(project_id);
      if (!project) throw notFound(`project ${project_id}`);
      if (!project.path || !project.present) throw badRequest(`the folder of ${project.name} is not on disk right now`);
      let page: { html: string; title: string };
      try {
        page = pageAsWidget(project.path, file);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return summary(
        store.surfaces.upsert({
          name: name ?? pageName(file),
          title: title ?? page.title,
          html: page.html,
          project_id: project.id,
          created_by: "owner",
          pinned,
        }),
      );
    },
    "sessions.native": ({ engine, limit }) => {
      const taken = store.harnessSessions.sessionIds(engine);
      return {
        sessions: nativeSessions(homes, engine, limit ?? 100)
          .filter((s) => !taken.has(s.id))
          .map(({ id, title, cwd, updated_at }) => ({ id, title, cwd, updated_at })),
      };
    },
    "sessions.resume": ({ engine, id }) => {
      const already = store.harnessSessions.threadOf(engine, id);
      const open = already ? store.threads.get(already) : undefined;
      if (open) return open;
      const s = nativeSession(homes, engine, id);
      if (!s) throw notFound(`${engine} session ${id}`);
      if (!fs.existsSync(s.cwd)) throw badRequest(`the session's folder ${s.cwd} is not on this machine anymore`);
      const agent = store.agents.list().find((a) => a.kind === "secretary") ?? store.agents.list()[0];
      if (!agent) throw notFound("an agent to own the session");
      const turns = nativeTranscript(s, SHOWN_TURNS);
      return store.tx(() => {
        const t = store.threads.create({
          kind: "code",
          title: s.title,
          agent_ids: [agent.id],
          project_id: projectOf(store, s.cwd),
          cwd: s.cwd,
          write: "ask",
          engine,
        });
        store.threads.mergeContext(t.id, { model_choice: { model: engine, router: false } });
        store.harnessSessions.set(t.id, engine, id);
        for (const turn of turns)
          store.messages.add({
            thread_id: t.id,
            author: turn.role === "user" ? { kind: "user" } : { kind: "agent", id: agent.id },
            parts: [{ type: "text", text: turn.text.slice(0, TURN_CHARS) }],
            ...(turn.role === "assistant" ? { model: engine } : {}),
          });
        const last = turns.at(-1)?.text ?? "";
        return store.threads.patch(t.id, { preview: last.slice(0, 140) });
      });
    },
  } satisfies Partial<Handlers>;
}
