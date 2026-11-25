import path from "node:path";
import { AGENT_DIR, LEGACY_DIR } from "../apc/folder.ts";
import { badRequest, notFound } from "../errors.ts";
import { realpath, samePath } from "../paths.ts";
import { contactRights } from "./contact-rights.ts";
import { readSource, saveSources, sourceBound, sourceState } from "./contact-source-state.ts";
import { contactSourceUpdates } from "./contact-source-updates.ts";
import { memorySettings } from "./memory-settings.ts";
import { newId } from "./sql.ts";
import type { Store } from "./store.ts";

type Excerpt = {
  source: string;
  label: string;
  revision?: string;
  unavailable?: string;
  offset?: number;
  next_offset?: number;
  total_chars?: number;
  text?: string;
};

function access(store: Store, threadId: string, agentId: string) {
  const thread = store.threads.get(threadId);
  const person = thread?.channel?.person_id ? store.persons.get(thread.channel.person_id) : undefined;
  if (
    memorySettings(store).mode === "off" ||
    !thread?.channel ||
    !person ||
    person.role !== "contact" ||
    person.agent_id !== agentId ||
    !thread.agent_ids.includes(agentId) ||
    store.threads.context(threadId).room ||
    store.agentMigrationPending.blocked(agentId, threadId) ||
    !contactRights(store, person, thread.channel.id).notes
  )
    throw badRequest("document consultation is not allowed here");
  return { thread, person };
}

export function contactSources(store: Store) {
  const get = (id: string) => sourceState(store).sources.find((s) => s.id === id);
  const allowed = (id: string, threadId: string, agentId: string) => {
    const { thread, person } = access(store, threadId, agentId);
    const source = get(id);
    if (
      !source ||
      source.person !== person.id ||
      source.agent !== agentId ||
      source.project !== thread.project_id ||
      !sourceBound(store, source)
    )
      throw notFound("authorized source");
    return source;
  };
  const list = (person: string) => sourceState(store).sources.filter((s) => s.person === person);
  return {
    get,
    list,
    available(threadId: string) {
      const thread = store.threads.get(threadId);
      const person = thread?.channel?.person_id ? store.persons.get(thread.channel.person_id) : undefined;
      if (!person?.agent_id) return false;
      try {
        access(store, threadId, person.agent_id);
        return list(person.id).some(
          (s) => s.agent === person.agent_id && s.project === thread?.project_id && sourceBound(store, s),
        );
      } catch {
        return false;
      }
    },
    set(input: {
      person: string;
      agent: string;
      project: string;
      path: string;
      label: string;
      allow_updates: boolean;
    }) {
      const project = store.projects.get(input.project);
      if (!project?.path || !project.present) throw badRequest("project has no local folder");
      const root = realpath(project.path);
      const clean = input.path.split(/[\\/]/);
      if (
        path.isAbsolute(input.path) ||
        clean.some((s) => ["..", ".git", AGENT_DIR, LEGACY_DIR].includes(s.toLowerCase())) ||
        !/\.(md|markdown|txt|csv)$/i.test(input.path) ||
        /^agents\.md$/i.test(path.basename(input.path))
      )
        throw badRequest("choose a specific text document inside the project");
      const source = { ...input, id: newId("csrc"), root, revision: "" };
      if (!sourceBound(store, source)) throw badRequest("the contact must be assigned to this project's agent");
      source.revision = readSource(store, source).revision;
      return store.tx(() => {
        const current = sourceState(store);
        const existing = current.sources.find(
          (s) =>
            s.person === input.person &&
            s.project === input.project &&
            samePath(path.join(s.root, s.path), path.join(root, input.path)),
        );
        if (existing) source.id = existing.id;
        current.sources = current.sources.filter((s) => s.id !== source.id);
        if (current.sources.filter((s) => s.person === input.person).length >= 30)
          throw badRequest("too many sources for this contact");
        current.sources.push(source);
        saveSources(store, current);
        return source;
      });
    },
    remove(id: string) {
      return store.tx(() => {
        const current = sourceState(store);
        const before = current.sources.length;
        current.sources = current.sources.filter((s) => s.id !== id);
        saveSources(store, current);
        return before !== current.sources.length;
      });
    },
    consult(threadId: string, agentId: string, query: string, id?: string, offset = 0): Excerpt[] {
      const { thread, person } = access(store, threadId, agentId);
      const sources = id
        ? [allowed(id, threadId, agentId)]
        : list(person.id).filter(
            (s) => s.agent === agentId && s.project === thread.project_id && sourceBound(store, s),
          );
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return sources
        .flatMap((s): Excerpt[] => {
          const live = allowed(s.id, threadId, agentId);
          let doc: ReturnType<typeof readSource>;
          try {
            doc = readSource(store, live);
          } catch {
            return [{ source: s.id, label: s.label, unavailable: "unavailable; waiting for owner review" }];
          }
          if (doc.revision !== live.revision)
            return [{ source: s.id, label: s.label, unavailable: "changed; waiting for owner review" }];
          const lower = doc.text.toLowerCase();
          const hits = id
            ? [offset]
            : [
                ...new Set(
                  words
                    .map((w) => lower.indexOf(w))
                    .filter((n) => n >= 0)
                    .map((n) => Math.max(0, n - 200)),
                ),
              ].slice(0, 2);
          const metadata = { source: s.id, label: s.label, revision: s.revision, total_chars: doc.text.length };
          if (!hits.length) return words.length ? [] : [metadata];
          return hits.map((start) => ({
            ...metadata,
            offset: start,
            next_offset: Math.min(start + 4000, doc.text.length),
            text: doc.text.slice(start, start + 4000),
          }));
        })
        .slice(0, words.length || id ? 4 : 30);
    },
    ...contactSourceUpdates(store, allowed),
  };
}
