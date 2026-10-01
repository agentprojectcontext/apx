// Repository over SQLite. Every write that changes what a client shows emits one event on the bus.
import { randomUUID } from "node:crypto";
import type {
  Agent,
  Author,
  Message,
  Part,
  Project,
  Run,
  RunState,
  Surface,
  SurfaceSummary,
  Thread,
} from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { Db } from "../db/db.ts";

const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

type Row = Record<string, unknown>;

function toThread(r: Row): Thread {
  return {
    id: String(r.id),
    kind: r.kind as Thread["kind"],
    title: String(r.title),
    agent_ids: JSON.parse(String(r.agent_ids)) as string[],
    ...(r.project_id ? { project_id: String(r.project_id) } : {}),
    ...(r.parent_id ? { parent_id: String(r.parent_id) } : {}),
    state: r.state as Thread["state"],
    preview: String(r.preview),
    unread: Number(r.unread),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function toMessage(r: Row): Message {
  return {
    id: String(r.id),
    thread_id: String(r.thread_id),
    seq: Number(r.seq),
    author: JSON.parse(String(r.author)) as Author,
    parts: JSON.parse(String(r.parts)) as Part[],
    ...(r.run_id ? { run_id: String(r.run_id) } : {}),
    ...(r.model ? { model: String(r.model) } : {}),
    created_at: String(r.created_at),
  };
}

function toRun(r: Row): Run {
  return {
    id: String(r.id),
    thread_id: String(r.thread_id),
    agent_id: String(r.agent_id),
    state: r.state as RunState,
    ...(r.error ? { error: String(r.error) } : {}),
    started_at: String(r.started_at),
    ...(r.ended_at ? { ended_at: String(r.ended_at) } : {}),
  };
}

function toAgent(r: Row): Agent & { prompt: string } {
  return {
    id: String(r.id),
    name: String(r.name),
    role: String(r.role),
    kind: r.kind as Agent["kind"],
    ...(r.blob ? { blob: String(r.blob) } : {}),
    ...(r.project_id ? { project_id: String(r.project_id) } : {}),
    browser_profile: r.browser_profile as Agent["browser_profile"],
    ...(r.model ? { model: String(r.model) } : {}),
    prompt: String(r.prompt),
  };
}

function toSurface(r: Row): Surface {
  return {
    id: String(r.id),
    name: String(r.name),
    title: String(r.title),
    html: String(r.html),
    version: Number(r.version),
    pinned: Boolean(r.pinned),
    app: Boolean(r.app),
    ...(r.project_id ? { project_id: String(r.project_id) } : {}),
    ...(r.thread_id ? { thread_id: String(r.thread_id) } : {}),
    created_by: String(r.created_by),
    updated_at: String(r.updated_at),
    ...(r.share_token ? { share_path: `/a/${String(r.share_token)}` } : {}),
  };
}

const summary = ({ html: _html, ...rest }: Surface): SurfaceSummary => rest;

export type AgentRecord = ReturnType<typeof toAgent>;

export function createStore(db: Db, bus: Bus) {
  const one = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as never[])) as Row | undefined;
  const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as Row[];
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...(args as never[]));

  const store = {
    // ── projects & agents ────────────────────────────────────────────────
    projects(): Project[] {
      return all("SELECT * FROM projects ORDER BY name").map((r) => ({
        id: String(r.id),
        name: String(r.name),
        ...(r.blob ? { blob: String(r.blob) } : {}),
        ...(r.path ? { path: String(r.path) } : {}),
      }));
    },
    upsertProject(p: Project): void {
      run(
        "INSERT INTO projects (id, name, blob, path, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = excluded.blob, path = excluded.path",
        p.id,
        p.name,
        p.blob ?? null,
        p.path ?? null,
        now(),
      );
    },
    agents(): AgentRecord[] {
      return all("SELECT * FROM agents ORDER BY kind DESC, name").map(toAgent);
    },
    agent(id: string): AgentRecord | undefined {
      const r = one("SELECT * FROM agents WHERE id = ? OR lower(name) = lower(?)", id, id);
      return r ? toAgent(r) : undefined;
    },
    upsertAgent(a: Agent & { prompt?: string }): void {
      run(
        `INSERT INTO agents (id, name, role, kind, blob, project_id, browser_profile, model, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, kind = excluded.kind, blob = excluded.blob,
           project_id = excluded.project_id, browser_profile = excluded.browser_profile, model = excluded.model, prompt = excluded.prompt`,
        a.id,
        a.name,
        a.role,
        a.kind,
        a.blob ?? null,
        a.project_id ?? null,
        a.browser_profile,
        a.model ?? null,
        a.prompt ?? "",
        now(),
      );
    },

    // ── threads ─────────────────────────────────────────────────────────
    threads(opts: { project_id?: string | undefined; include_subthreads?: boolean } = {}): Thread[] {
      const where: string[] = [];
      const args: unknown[] = [];
      if (!opts.include_subthreads) where.push("parent_id IS NULL");
      if (opts.project_id) {
        where.push("project_id = ?");
        args.push(opts.project_id);
      }
      return all(
        `SELECT * FROM threads ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 300`,
        ...args,
      ).map(toThread);
    },
    thread(id: string): Thread | undefined {
      const r = one("SELECT * FROM threads WHERE id = ?", id);
      return r ? toThread(r) : undefined;
    },
    createThread(
      t: Pick<Thread, "kind" | "title" | "agent_ids"> & {
        project_id?: string | undefined;
        parent_id?: string | undefined;
        id?: string;
      },
    ): Thread {
      const ts = now();
      const id = t.id ?? newId("th");
      run(
        "INSERT INTO threads (id, kind, title, agent_ids, project_id, parent_id, state, preview, unread, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'idle', '', 0, ?, ?)",
        id,
        t.kind,
        t.title,
        JSON.stringify(t.agent_ids),
        t.project_id ?? null,
        t.parent_id ?? null,
        ts,
        ts,
      );
      const thread = store.thread(id) as Thread;
      bus.emit({ type: "thread.updated", thread });
      return thread;
    },
    patchThread(
      id: string,
      patch: Partial<Pick<Thread, "state" | "preview" | "unread" | "title">>,
      touch = true,
    ): Thread {
      const cur = store.thread(id);
      if (!cur) throw new Error(`unknown thread ${id}`);
      const next = { ...cur, ...patch, updated_at: touch ? now() : cur.updated_at };
      run(
        "UPDATE threads SET state = ?, preview = ?, unread = ?, title = ?, updated_at = ? WHERE id = ?",
        next.state,
        next.preview,
        next.unread,
        next.title,
        next.updated_at,
        id,
      );
      bus.emit({ type: "thread.updated", thread: next });
      return next;
    },

    // ── messages ────────────────────────────────────────────────────────
    messages(threadId: string, limit = 200): Message[] {
      return all(
        "SELECT * FROM (SELECT * FROM messages WHERE thread_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq",
        threadId,
        limit,
      ).map(toMessage);
    },
    addMessage(m: { thread_id: string; author: Author; parts: Part[]; run_id?: string; model?: string }): Message {
      const seqRow = one("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE thread_id = ?", m.thread_id);
      const message: Message = {
        id: newId("msg"),
        thread_id: m.thread_id,
        seq: Number(seqRow?.next ?? 1),
        author: m.author,
        parts: m.parts,
        ...(m.run_id ? { run_id: m.run_id } : {}),
        ...(m.model ? { model: m.model } : {}),
        created_at: now(),
      };
      run(
        "INSERT INTO messages (id, thread_id, seq, author, parts, run_id, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        message.id,
        message.thread_id,
        message.seq,
        JSON.stringify(message.author),
        JSON.stringify(message.parts),
        message.run_id ?? null,
        message.model ?? null,
        message.created_at,
      );
      bus.emit({ type: "message.created", message });
      return message;
    },
    updateMessage(message: Message): Message {
      run(
        "UPDATE messages SET parts = ?, model = ? WHERE id = ?",
        JSON.stringify(message.parts),
        message.model ?? null,
        message.id,
      );
      bus.emit({ type: "message.updated", message });
      return message;
    },

    // ── model log (what the model saw) ───────────────────────────────────
    modelLog(threadId: string, limit = 60): unknown[] {
      return all(
        "SELECT item FROM (SELECT * FROM model_log WHERE thread_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq",
        threadId,
        limit,
      ).map((r) => JSON.parse(String(r.item)));
    },
    appendModelLog(threadId: string, items: unknown[]): void {
      const base = Number(
        one("SELECT COALESCE(MAX(seq), 0) AS m FROM model_log WHERE thread_id = ?", threadId)?.m ?? 0,
      );
      const stmt = db.prepare("INSERT INTO model_log (thread_id, seq, item) VALUES (?, ?, ?)");
      for (const [i, item] of items.entries()) stmt.run(threadId, base + i + 1, JSON.stringify(item));
    },

    // ── runs ────────────────────────────────────────────────────────────
    runs(threadId: string): Run[] {
      return all("SELECT * FROM runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 20", threadId).map(toRun);
    },
    createRun(threadId: string, agentId: string): Run {
      const r: Run = {
        id: newId("run"),
        thread_id: threadId,
        agent_id: agentId,
        state: "submitted",
        started_at: now(),
      };
      run(
        "INSERT INTO runs (id, thread_id, agent_id, state, started_at) VALUES (?, ?, ?, ?, ?)",
        r.id,
        r.thread_id,
        r.agent_id,
        r.state,
        r.started_at,
      );
      bus.emit({ type: "run.updated", run: r });
      return r;
    },
    setRunState(r: Run, state: RunState, error?: string): Run {
      const terminal = state === "completed" || state === "failed" || state === "canceled";
      const next: Run = { ...r, state, ...(error ? { error } : {}), ...(terminal ? { ended_at: now() } : {}) };
      run(
        "UPDATE runs SET state = ?, error = ?, ended_at = ? WHERE id = ?",
        state,
        error ?? null,
        next.ended_at ?? null,
        r.id,
      );
      bus.emit({ type: "run.updated", run: next });
      return next;
    },
    /** Runs left non-terminal by a crash or restart: honest terminal state instead of a ghost "working". */
    failOrphanRuns(): number {
      const res = run(
        "UPDATE runs SET state = 'failed', error = 'interrupted by restart', ended_at = ? WHERE state IN ('submitted','working','input-required')",
        now(),
      );
      run("UPDATE threads SET state = 'failed' WHERE state IN ('submitted','working','input-required')");
      return Number(res.changes);
    },

    // ── surfaces ────────────────────────────────────────────────────────
    surfaces(projectId?: string): SurfaceSummary[] {
      const rows = projectId
        ? all("SELECT * FROM surfaces WHERE project_id = ? OR project_id IS NULL ORDER BY updated_at DESC", projectId)
        : all("SELECT * FROM surfaces ORDER BY updated_at DESC");
      return rows.map((r) => summary(toSurface(r)));
    },
    surface(id: string): Surface | undefined {
      const r = one("SELECT * FROM surfaces WHERE id = ? OR name = ?", id, id);
      return r ? toSurface(r) : undefined;
    },
    upsertSurface(s: {
      name: string;
      title: string;
      html: string;
      project_id?: string | undefined;
      thread_id?: string | undefined;
      created_by: string;
      pinned?: boolean | undefined;
      app?: boolean | undefined;
    }): Surface {
      const existing = one(
        "SELECT * FROM surfaces WHERE COALESCE(project_id, '') = ? AND name = ?",
        s.project_id ?? "",
        s.name,
      );
      const ts = now();
      if (existing) {
        const cur = toSurface(existing);
        const next: Surface = {
          ...cur,
          title: s.title,
          html: s.html,
          version: cur.version + 1,
          pinned: s.pinned ?? cur.pinned,
          app: s.app ?? cur.app,
          updated_at: ts,
        };
        run(
          "UPDATE surfaces SET title = ?, html = ?, version = ?, pinned = ?, app = ?, updated_at = ? WHERE id = ?",
          next.title,
          next.html,
          next.version,
          Number(next.pinned),
          Number(next.app),
          ts,
          cur.id,
        );
        bus.emit({ type: "surface.updated", surface: summary(next) });
        return next;
      }
      const created: Surface = {
        id: newId("srf"),
        name: s.name,
        title: s.title,
        html: s.html,
        version: 1,
        pinned: s.pinned ?? false,
        app: s.app ?? false,
        ...(s.project_id ? { project_id: s.project_id } : {}),
        ...(s.thread_id ? { thread_id: s.thread_id } : {}),
        created_by: s.created_by,
        updated_at: ts,
      };
      run(
        "INSERT INTO surfaces (id, name, title, html, version, pinned, app, project_id, thread_id, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        created.id,
        created.name,
        created.title,
        created.html,
        1,
        Number(created.pinned),
        Number(created.app),
        created.project_id ?? null,
        created.thread_id ?? null,
        created.created_by,
        ts,
      );
      bus.emit({ type: "surface.updated", surface: summary(created) });
      return created;
    },
    patchSurface(id: string, patch: { pinned?: boolean | undefined; app?: boolean | undefined }): SurfaceSummary {
      const cur = store.surface(id);
      if (!cur) throw new Error(`unknown surface ${id}`);
      const next = { ...cur, pinned: patch.pinned ?? cur.pinned, app: patch.app ?? cur.app, updated_at: now() };
      run(
        "UPDATE surfaces SET pinned = ?, app = ?, updated_at = ? WHERE id = ?",
        Number(next.pinned),
        Number(next.app),
        next.updated_at,
        cur.id,
      );
      bus.emit({ type: "surface.updated", surface: summary(next) });
      return summary(next);
    },

    shareSurface(id: string, shared: boolean): SurfaceSummary {
      const cur = store.surface(id);
      if (!cur) throw new Error(`unknown surface ${id}`);
      const token = shared ? (cur.share_path?.slice(3) ?? randomUUID().replaceAll("-", "")) : null;
      run("UPDATE surfaces SET share_token = ? WHERE id = ?", token, cur.id);
      const next = store.surface(cur.id) as Surface;
      bus.emit({ type: "surface.updated", surface: summary(next) });
      return summary(next);
    },
    surfaceByShareToken(token: string): Surface | undefined {
      const r = one("SELECT * FROM surfaces WHERE share_token = ?", token);
      return r ? toSurface(r) : undefined;
    },

    // ── idempotency ─────────────────────────────────────────────────────
    idemGet(key: string, method: string): unknown | undefined {
      const r = one("SELECT response FROM idempotency WHERE key = ? AND method = ?", key, method);
      return r ? JSON.parse(String(r.response)) : undefined;
    },
    idemPut(key: string, method: string, response: unknown): void {
      run(
        "INSERT OR IGNORE INTO idempotency (key, method, response, created_at) VALUES (?, ?, ?, ?)",
        key,
        method,
        JSON.stringify(response),
        now(),
      );
    },
  };
  return store;
}

export type Store = ReturnType<typeof createStore>;
