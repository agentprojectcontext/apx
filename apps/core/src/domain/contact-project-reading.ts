// A contact's explicitly assigned agent reads its own project for them: the project's notes, the owner's chats there
// and the documents the owner referenced in them, read-only. A reference is found only in owner-written text and
// handed out as an opaque handle that is checked again before and after every read. See DECISIONS.md#d-263.
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Memory, Message, Thread } from "@apx/protocol";
import { badRequest, conflict, notFound } from "../errors.ts";
import { isInside, realpath } from "../paths.ts";
import { canReadOwnScope, canUseChatMemory, memoryEligibleChat } from "./chat-access.ts";
import { contactProjectRecords } from "./contact-project-records.ts";
import { contactRights } from "./contact-rights.ts";
import { readSource, type SourceUpdate, sourceHash } from "./contact-source-state.ts";
import { memorySettings } from "./memory-settings.ts";
import type { Store } from "./store.ts";

/** Characters per read window: even an all-"<" window fits the executor's result cap once escaped. */
const DOCUMENT_WINDOW = 2_400;
const SNIPPET_CHARS = 600;
const REFS_PER_ORIGIN = 6;
const HANDLES_PER_STORE = 300;
const TEXT_FILE = /\.(md|markdown|txt|csv)$/i;
const SECRET_NAME = /secret|credential|passw|token|api[-_]?key|private[-_]?key|\.env/i;
const DRIVE_HOSTS: ReadonlySet<string> = new Set(["docs.google.com", "drive.google.com"]);
const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;

type Target = { kind: "drive"; id: string } | { kind: "file"; path: string };
type Origin = { kind: "message"; id: string } | { kind: "memory"; id: string } | { kind: "project" };
type Handle = { key: string; origin: Origin; target: Target };
export type Reference = { ref: string; kind: Target["kind"]; label: string };
export type Finding = {
  from: "note" | "chat" | "project";
  cite: string;
  text: string;
  refs: Reference[];
  record_revision?: string;
};

export function projectRecordSourceAvailable(store: Store, update: SourceUpdate): boolean {
  const meta = update.project_record;
  const a = meta && projectReadingAccess(store, update.thread, meta.agent);
  if (!a || !meta.reference || a.person.id !== update.person || a.project.id !== meta.project) return false;
  const { origin, target } = meta.reference;
  const text = originText(store, a, origin);
  return (
    text !== undefined &&
    targetsIn(text, a.project).some((t) => sameTarget(t, target)) &&
    update.source === `record_${sourceHash(JSON.stringify([a.person.id, a.agent.id, a.project.id, target]))}`
  );
}
type DriveWindow = {
  name: string;
  text: string;
  revision: string;
  offset: number;
  total_chars: number;
  next_offset: number | null;
};
/** Reads one Drive file's text window through the owner's connected Drive, in the given project. */
export type DriveReader = (
  id: string,
  o: { project: string; offset?: number | undefined; revision?: string | undefined; signal?: AbortSignal | undefined },
) => Promise<DriveWindow>;

const registry = new WeakMap<Store, Map<string, Handle>>();
const handlesOf = (store: Store) => {
  const map = registry.get(store) ?? new Map<string, Handle>();
  registry.set(store, map);
  return map;
};

/** Who may read, checked on every call: an explicit assignment in its own project, never an account's fallback. */
function projectReadingAccess(store: Store, threadId: string, agentId: string) {
  const thread = store.threads.get(threadId);
  const person = thread?.channel?.person_id ? store.persons.get(thread.channel.person_id) : undefined;
  const agent = store.agents.get(agentId);
  const project = agent?.project_id ? store.projects.get(agent.project_id) : undefined;
  const context = thread ? store.threads.context(thread.id) : undefined;
  if (
    !thread?.channel ||
    !person ||
    !agent ||
    !project ||
    person.role !== "contact" ||
    person.agent_id !== agent.id ||
    thread.project_id !== project.id ||
    !thread.agent_ids.includes(agent.id) ||
    context?.room ||
    context?.client ||
    store.agentMigrationPending.blocked(agent.id, thread.id) ||
    memorySettings(store).mode === "off" ||
    !contactRights(store, person, thread.channel.id).project_reading ||
    sharedWithOthers(store, project.id, person.id)
  )
    return undefined;
  return { thread, person, agent, project, key: [person.id, agent.id, project.id, thread.id].join("|") };
}
type Access = NonNullable<ReturnType<typeof projectReadingAccess>>;

/** Another contact assigned to an agent of the project could be in its chats: then nobody reads it this way. */
function sharedWithOthers(store: Store, project: string, person: string) {
  const agents = new Set(
    store.agents
      .list()
      .filter((a) => a.project_id === project)
      .map((a) => a.id),
  );
  return store.persons
    .list()
    .some((p) => p.id !== person && p.role === "contact" && p.agent_id !== undefined && agents.has(p.agent_id));
}

const textOf = (m: Message) =>
  m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();

/** The owner's own chats of the project with this agent: no contact's, room, client, worker or delegated chat. */
function ownerChat(store: Store, a: Access, t: Thread | undefined): t is Thread {
  return (
    !!t &&
    t.id !== a.thread.id &&
    t.project_id === a.project.id &&
    t.agent_ids.includes(a.agent.id) &&
    memoryEligibleChat(store, t) &&
    canReadOwnScope(store, a.agent, t)
  );
}

function ownerMessage(store: Store, a: Access, m: Message | undefined): m is Message {
  if (m?.author.kind !== "user" || m.author.direct || !ownerChat(store, a, store.threads.get(m.thread_id)))
    return false;
  return !store.memories.excluded({ agent_id: a.agent.id, project_id: a.project.id }, textOf(m), {
    message_id: m.id,
    ...(m.run_id ? { run_id: m.run_id } : {}),
  });
}

/** Project notes and this agent's notebook in the project, standing and untainted. */
function projectNote(store: Store, a: Access, m: Memory | undefined): m is Memory {
  return (
    !!m &&
    !m.forgotten_at &&
    !m.pending &&
    !m.tainted &&
    m.project_id === a.project.id &&
    (m.scope === "project" || (m.scope === "agent" && m.agent_id === a.agent.id)) &&
    canUseChatMemory(store, { project_id: a.project.id }, m)
  );
}

/** A project-relative text file; never hidden, administrative, secret-looking or outside the folder. */
function filePath(root: string, raw: string): string | undefined {
  const rel = path.isAbsolute(raw) ? (isInside(root, raw) ? path.relative(root, raw) : undefined) : raw;
  if (!rel || rel.length > 300 || rel.includes("\\")) return undefined;
  const parts = rel.split("/");
  const base = parts.at(-1) ?? "";
  if (
    parts.some((s) => !s || s.startsWith(".") || s === "~") ||
    !TEXT_FILE.test(base) ||
    /^agents\.md$/i.test(base) ||
    SECRET_NAME.test(rel)
  )
    return undefined;
  return rel;
}

/** A Drive file's id from a link to it; the link itself is never opened. */
function driveId(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.replace(/[.,;:!?]+$/, ""));
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !DRIVE_HOSTS.has(url.hostname) || url.username || url.port) return undefined;
  const id = url.pathname.match(/\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id") ?? "";
  return DRIVE_ID.test(id) ? id : undefined;
}

/** The documents a piece of owner-written text points at. */
function targetsIn(text: string, project: { path?: string | undefined; present: boolean }): Target[] {
  const out: Target[] = [];
  const add = (t: Target) => {
    if (out.length < REFS_PER_ORIGIN && !out.some((o) => sameTarget(o, t))) out.push(t);
  };
  for (const [url] of text.matchAll(/https:\/\/[^\s<>"'`)\]]+/g)) {
    const id = driveId(url);
    if (id) add({ kind: "drive", id });
  }
  if (project.path && project.present) {
    const folder = project.path;
    const roots = [folder];
    try {
      roots.push(realpath(folder));
    } catch {
      // A folder gone since the last scan: its files are unavailable when read.
    }
    // A name right after a backslash is the tail of a Windows path, never a file of this project.
    for (const [, raw = ""] of text.matchAll(
      /(?<![\w:/\\.~-])((?:\/[^\s"'`<>()[\]]+)|(?:[\w-]+\/)*[\w-][\w.-]*)(?![\w/\\])/g,
    )) {
      const clean = raw.replace(/[.,;:!?]+$/, "");
      if (!TEXT_FILE.test(clean)) continue;
      const rel = roots.map((r) => filePath(r, clean)).find(Boolean);
      if (rel) add({ kind: "file", path: rel });
    }
  }
  return out;
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === "drive" ? a.id === (b as typeof a).id : a.path === (b as typeof a).path);

/** The text an origin holds now, if it may still lend references to this reader. */
function originText(store: Store, a: Access, o: Origin): string | undefined {
  if (o.kind === "project") return a.project.description;
  if (o.kind === "message") {
    const m = store.messages.get(o.id);
    return ownerMessage(store, a, m) ? textOf(m) : undefined;
  }
  const note = store.memories.get(o.id);
  return projectNote(store, a, note) && note.source === "owner" ? note.text : undefined;
}

function handleFor(store: Store, a: Access, origin: Origin, target: Target): Reference {
  const handles = handlesOf(store);
  const label = target.kind === "drive" ? "Drive document" : path.basename(target.path);
  const same = (h: Handle) => h.key === a.key && sameOrigin(h.origin, origin) && sameTarget(h.target, target);
  for (const [ref, h] of handles) if (same(h)) return { ref, kind: target.kind, label };
  const ref = `ref_${randomBytes(12).toString("base64url")}`;
  handles.set(ref, { key: a.key, origin, target });
  while (handles.size > HANDLES_PER_STORE) handles.delete(handles.keys().next().value as string);
  return { ref, kind: target.kind, label };
}

const sameOrigin = (a: Origin, b: Origin) =>
  a.kind === b.kind && (a.kind === "project" || a.id === (b as { id: string }).id);

const cut = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
};

function recordFindings(store: Store, a: Access, query: string): Finding[] {
  return contactProjectRecords(store)
    .list({ person: a.person.id, agent: a.agent.id, project: a.project.id })
    .filter((r) =>
      query
        .toLowerCase()
        .split(/\s+/)
        .some((term) => term.length > 1 && `${r.label} ${r.text}`.toLowerCase().includes(term)),
    )
    .slice(0, 3)
    .map((r) => ({
      from: "note",
      cite: `Private project record: ${r.label}`,
      record_revision: r.revision,
      text: cut(r.text),
      refs: [],
    }));
}

function readingAccessOrThrow(store: Store, thread: string, agent: string) {
  const a = projectReadingAccess(store, thread, agent);
  if (!a) throw badRequest("project reading is not allowed here");
  return a;
}

function resolveHandle(store: Store, thread: string, agent: string, ref: string) {
  const a = readingAccessOrThrow(store, thread, agent);
  const h = handlesOf(store).get(ref);
  const text = h && h.key === a.key ? originText(store, a, h.origin) : undefined;
  if (!h || text === undefined || !targetsIn(text, a.project).some((t) => sameTarget(t, h.target)))
    throw notFound("document reference; search the project again");
  return { a, h };
}

export function contactProjectReading(store: Store, readDrive?: DriveReader) {
  const enter = (thread: string, agent: string) => readingAccessOrThrow(store, thread, agent);
  const resolve = (thread: string, agent: string, ref: string) => resolveHandle(store, thread, agent, ref);
  const api = {
    available: (threadId: string, agentId: string) => Boolean(projectReadingAccess(store, threadId, agentId)),
    async propose(
      thread: string,
      agent: string,
      run: string,
      ref: string,
      revision: string,
      old: string,
      replacement: string,
      signal?: AbortSignal,
      recordRevision?: string,
    ) {
      const doc = await api.read(thread, agent, ref, { revision, signal });
      const { a, h } = resolve(thread, agent, ref);
      const source = `record_${sourceHash(JSON.stringify([a.person.id, a.agent.id, a.project.id, h.target]))}`;
      return contactProjectRecords(store).propose({
        person: a.person.id,
        agent,
        project: a.project.id,
        thread,
        run,
        source,
        label: doc.label,
        source_revision: doc.revision,
        reference: { origin: h.origin, target: h.target },
        ...(recordRevision ? { record_revision: recordRevision } : {}),
        old,
        replacement,
      });
    },

    /** Notes and the owner's messages that match, each with the documents it references. */
    search(threadId: string, agentId: string, query: string): Finding[] {
      const a = enter(threadId, agentId);
      const refs = (origin: Origin, text: string) =>
        targetsIn(text, a.project).map((t) => handleFor(store, a, origin, t));
      const notes = [
        ...store.memories.list({ scope: "project", project_id: a.project.id, pending: false, query, limit: 20 }),
        ...store.memories.list({
          scope: "agent",
          agent_id: a.agent.id,
          project_id: a.project.id,
          pending: false,
          query,
          limit: 20,
        }),
      ]
        .filter((m) => projectNote(store, a, m))
        .slice(0, 6)
        .map(
          (m): Finding => ({
            from: "note",
            cite: "project note",
            text: cut(m.text),
            refs: m.source === "owner" ? refs({ kind: "memory", id: m.id }, m.text) : [],
          }),
        );
      const chats = new Map(
        store.threads
          .list({ project_id: a.project.id, include_archived: true, limit: 200 })
          .filter((t) => ownerChat(store, a, t))
          .map((t) => [t.id, t]),
      );
      const said = store.messages
        .recall(query, [...chats.keys()], 8)
        .filter((m) => ownerMessage(store, a, m))
        .map(
          (m): Finding => ({
            from: "chat",
            cite: `owner in "${chats.get(m.thread_id)?.title ?? "chat"}", ${m.created_at.slice(0, 10)}`,
            text: cut(textOf(m)),
            refs: refs({ kind: "message", id: m.id }, textOf(m)),
          }),
        );
      const about = a.project.description
        ? [
            {
              from: "project" as const,
              cite: `project "${a.project.name}"`,
              text: cut(a.project.description),
              refs: refs({ kind: "project" }, a.project.description),
            },
          ]
        : [];
      return [...recordFindings(store, a, query), ...notes, ...said, ...about];
    },

    /** One window of a referenced document as it is now, with its revision for continuing. */
    async read(
      threadId: string,
      agentId: string,
      ref: string,
      o: { offset?: number | undefined; revision?: string | undefined; signal?: AbortSignal | undefined } = {},
    ) {
      const { a, h } = resolve(threadId, agentId, ref);
      if (h.target.kind === "drive") {
        if (!readDrive) throw conflict("Drive is not connected for this project");
        const window = await readDrive(h.target.id, { project: a.project.id, ...o });
        // The owner may have revoked, reassigned or removed the reference while Drive answered.
        resolve(threadId, agentId, ref);
        const { name, ...rest } = window;
        return { label: name, source: "Drive", ...rest };
      }
      const project = a.project;
      if (!project.path || !project.present) throw conflict("the project's folder is not available");
      let text: string;
      let revision: string;
      try {
        ({ text, revision } = readSource(store, {
          id: ref,
          person: a.person.id,
          agent: a.agent.id,
          project: project.id,
          label: h.target.path,
          path: h.target.path,
          revision: "",
          allow_updates: false,
          root: realpath(project.path),
        }));
      } catch {
        throw conflict("the referenced document is unavailable");
      }
      if (o.revision && o.revision !== revision) throw conflict("the document changed; read again from offset 0");
      resolve(threadId, agentId, ref);
      const offset = o.offset ?? 0;
      if (offset > text.length) throw badRequest("offset past the end of the document");
      const end = Math.min(offset + DOCUMENT_WINDOW, text.length);
      return {
        label: path.basename(h.target.path),
        source: "project file",
        text: text.slice(offset, end),
        revision,
        offset,
        total_chars: text.length,
        next_offset: end < text.length ? end : null,
      };
    },
  };
  return api;
}
