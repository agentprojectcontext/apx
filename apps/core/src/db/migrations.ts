// Append-only. Never edit a shipped migration; add the next one.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, blob TEXT, path TEXT, created_at TEXT NOT NULL);
  CREATE TABLE agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
    blob TEXT, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    browser_profile TEXT NOT NULL DEFAULT 'shared', model TEXT, prompt TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE threads (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, agent_ids TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, parent_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'idle', preview TEXT NOT NULL DEFAULT '', unread INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX threads_updated ON threads(updated_at DESC);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
    author TEXT NOT NULL, parts TEXT NOT NULL, run_id TEXT, model TEXT, created_at TEXT NOT NULL,
    UNIQUE(thread_id, seq)
  );
  -- What the model saw, verbatim (provider message objects). Never rendered as-is.
  CREATE TABLE model_log (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, seq INTEGER NOT NULL, item TEXT NOT NULL,
    PRIMARY KEY (thread_id, seq)
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, agent_id TEXT NOT NULL,
    state TEXT NOT NULL, error TEXT, started_at TEXT NOT NULL, ended_at TEXT
  );
  CREATE TABLE surfaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL, version INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0, app INTEGER NOT NULL DEFAULT 0, project_id TEXT, thread_id TEXT,
    created_by TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX surfaces_name ON surfaces(COALESCE(project_id, ''), name);
  CREATE TABLE idempotency (key TEXT PRIMARY KEY, method TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
  `,
  `
  ALTER TABLE surfaces ADD COLUMN share_token TEXT;
  CREATE UNIQUE INDEX surfaces_share ON surfaces(share_token) WHERE share_token IS NOT NULL;
  `,
  `ALTER TABLE runs ADD COLUMN usage TEXT;`,
  `
  ALTER TABLE agents ADD COLUMN harness TEXT;
  -- An external harness (Claude Code, Codex) keeps its own conversation; we keep its id per thread.
  CREATE TABLE harness_sessions (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, harness TEXT NOT NULL, session_id TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY (thread_id, harness)
  );
  `,
  `
  -- A run is also the durable admission queue: it is stored with its input before it starts.
  ALTER TABLE runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'user';
  ALTER TABLE runs ADD COLUMN input TEXT;
  ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
  ALTER TABLE runs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN deadline_at TEXT;
  ALTER TABLE runs ADD COLUMN harness TEXT;
  ALTER TABLE runs ADD COLUMN model TEXT;
  ALTER TABLE runs ADD COLUMN message_id TEXT;
  ALTER TABLE runs ADD COLUMN created_at TEXT;
  UPDATE runs SET created_at = started_at;
  CREATE INDEX runs_thread_state ON runs(thread_id, state);
  CREATE INDEX runs_parent ON runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
  -- One row per tool call, written before the tool runs: after a crash we know what may have happened.
  CREATE TABLE steps (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
    call_id TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, effect TEXT NOT NULL, state TEXT NOT NULL,
    result TEXT, started_at TEXT NOT NULL, ended_at TEXT, UNIQUE (run_id, call_id)
  );
  ALTER TABLE model_log ADD COLUMN run_id TEXT;
  -- Per-thread context bookkeeping (e.g. the roster the agent last saw), so unchanged facts are not repeated.
  ALTER TABLE threads ADD COLUMN context TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE idempotency_v2 (
    key TEXT NOT NULL, method TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (key, method)
  );
  INSERT OR IGNORE INTO idempotency_v2 SELECT key, method, response, created_at FROM idempotency;
  DROP TABLE idempotency;
  ALTER TABLE idempotency_v2 RENAME TO idempotency;
  `,
  `
  -- An agent's model choice: { model?: "<engine>/<model>", router: boolean }. Replaces the harness and model columns,
  -- which stay unused (append-only schema).
  ALTER TABLE agents ADD COLUMN model_choice TEXT;
  UPDATE agents SET model_choice = json_object(
    'model', harness || CASE WHEN model IS NOT NULL AND model != '' THEN '/' || model ELSE '' END,
    'router', json('false')
  ) WHERE harness IS NOT NULL;
  `,
  `
  -- Projects are folders registered by path; their AGENTS.md and .apc/ are the source of truth for definitions.
  ALTER TABLE projects ADD COLUMN description TEXT;
  ALTER TABLE projects ADD COLUMN kind TEXT;
  ALTER TABLE projects ADD COLUMN context TEXT;
  ALTER TABLE projects ADD COLUMN present INTEGER NOT NULL DEFAULT 1;
  -- Agents mirrored from .apc/agents/<slug>.md carry source 'apc'; one whose file is gone is archived, not deleted
  -- (threads and runs still point at it).
  ALTER TABLE agents ADD COLUMN slug TEXT;
  ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE agents ADD COLUMN parent TEXT;
  ALTER TABLE agents ADD COLUMN description TEXT;
  ALTER TABLE agents ADD COLUMN extra TEXT;
  ALTER TABLE agents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- "native" was a harness, never a model: choices that named it fall back to the router.
  UPDATE agents SET model_choice = json_object('router', json('true'))
    WHERE json_extract(model_choice, '$.model') LIKE 'native%';
  UPDATE meta SET value = json_object('router', json('true'))
    WHERE key = 'setting:model_default' AND json_extract(value, '$.model') LIKE 'native%';
  DELETE FROM meta WHERE key = 'setting:default_harness' AND value = 'native';
  `,
  `
  -- What a run is doing, for the background view: how many tools it called and the one running now.
  ALTER TABLE runs ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN activity TEXT;
  `,
  `
  -- What an agent waits on from the owner: a confirmation before a tool runs, or a question. Outlives restarts; an
  -- answer that arrives after its run is gone wakes the agent with a new run.
  CREATE TABLE pending_inputs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    message_id TEXT,
    call_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    tool TEXT,
    args TEXT,
    detail TEXT,
    options TEXT,
    state TEXT NOT NULL DEFAULT 'pending',
    answer TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE INDEX pending_inputs_state ON pending_inputs(state, thread_id);
  -- A tool's full output; the model gets head and tail, and read_output pages through the rest.
  ALTER TABLE steps ADD COLUMN output TEXT;
  `,
  `
  -- a2a sessions: a delegation's sub-thread has a name its caller uses to continue it later (unique per parent).
  ALTER TABLE threads ADD COLUMN session TEXT;
  CREATE UNIQUE INDEX threads_session ON threads(parent_id, session) WHERE session IS NOT NULL;
  `,
  `
  -- Terminal jobs: a shell command an agent started, its output in a file under the home. Reconciled at boot.
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    run_id TEXT,
    agent_id TEXT,
    title TEXT NOT NULL,
    cwd TEXT NOT NULL,
    pid INTEGER,
    state TEXT NOT NULL,
    exit_code INTEGER,
    background INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX jobs_state ON jobs(state, started_at);
  `,
  `
  -- A job's process start time (as ps prints it): after a restart, a live pid is stopped only if it is still ours.
  ALTER TABLE jobs ADD COLUMN proc_start TEXT;
  `,
  `
  -- Code threads: the folder the agent works in and what it may change there.
  ALTER TABLE threads ADD COLUMN cwd TEXT;
  ALTER TABLE threads ADD COLUMN write_policy TEXT;
  `,
  `
  -- Memory: notes agents keep between threads, with full-text search (accents ignored). Column n is the stable rowid the
  -- index points at (an implicit rowid may change on VACUUM).
  CREATE TABLE memories (
    n INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    project_id TEXT,
    agent_id TEXT,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    author_agent TEXT,
    thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX memories_scope ON memories(scope, project_id, agent_id);
  CREATE VIRTUAL TABLE memories_fts USING fts5(
    text, content='memories', content_rowid='n', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, text) VALUES (new.n, new.text);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.n, old.text);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE OF text ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.n, old.text);
    INSERT INTO memories_fts(rowid, text) VALUES (new.n, new.text);
  END;
  -- A project's .apc/memory.md, written by the owner: project context like AGENTS.md.
  ALTER TABLE projects ADD COLUMN memory_md TEXT;
  `,
  `
  -- A note an agent saved while outside content (web, another agent, a message) was in its turn: shown as data.
  ALTER TABLE memories ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Channels. People and their addresses on each channel (the owner is a person too).
  CREATE TABLE persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE addresses (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    external_id TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (channel, external_id)
  );
  -- A channel conversation's thread.
  ALTER TABLE threads ADD COLUMN channel TEXT;
  ALTER TABLE threads ADD COLUMN conversation TEXT;
  ALTER TABLE threads ADD COLUMN person_id TEXT;
  CREATE UNIQUE INDEX threads_channel ON threads(channel, conversation) WHERE channel IS NOT NULL;
  -- Every inbound message is stored before the platform is told it arrived; a restart picks up what was not handled.
  CREATE TABLE channel_inbox (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    external_id TEXT NOT NULL,
    conversation TEXT NOT NULL,
    sender TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (channel, external_id)
  );
  CREATE INDEX channel_inbox_state ON channel_inbox(state);
  -- Everything a channel sends: written before sending; a send that may or may not have arrived is "uncertain".
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    conversation TEXT NOT NULL,
    thread_id TEXT,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    external_id TEXT,
    error TEXT,
    next_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX outbox_state ON outbox(state, next_at);
  -- A stranger's pending request to talk, approved by the owner with its code.
  CREATE TABLE pairing (
    code TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    external_id TEXT NOT NULL,
    conversation TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX pairing_sender ON pairing(channel, external_id);
  `,
  `
  -- Media APX made (images, speech): the bytes live in a file under the home, the row says what and where.
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    path TEXT NOT NULL,
    thread_id TEXT,
    service TEXT,
    prompt TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX media_thread ON media(thread_id, created_at);
  `,
  `
  -- Memory by meaning: each note's embedding (float32 little-endian) and which engine and model made it.
  ALTER TABLE memories ADD COLUMN embedding BLOB;
  ALTER TABLE memories ADD COLUMN embedding_model TEXT;
  `,
  `
  -- Office: tasks (the row is the current state; task_events keeps the history) with a thread for their conversation.
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    assignee TEXT,
    parent_id TEXT,
    thread_id TEXT NOT NULL,
    awaits_owner INTEGER NOT NULL DEFAULT 0,
    due_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    activity_at TEXT NOT NULL
  );
  CREATE INDEX tasks_project ON tasks(project_id, state, activity_at);
  CREATE UNIQUE INDEX tasks_thread ON tasks(thread_id);
  CREATE TABLE task_events (
    n INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    op TEXT NOT NULL,
    by TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX task_events_task ON task_events(task_id, n);
  `,
  `
  -- Routines: work an agent does on a schedule. next_run_at is reserved before a run starts; lease_until keeps the
  -- same routine from running twice at once. Each run's state lives in runs.
  CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_id TEXT,
    agent_id TEXT NOT NULL,
    schedule TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT,
    lease_until TEXT,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX routines_due ON routines(enabled, next_run_at);
  CREATE TABLE routine_runs (
    run_id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    delivered INTEGER
  );
  CREATE INDEX routine_runs_routine ON routine_runs(routine_id, started_at);
  `,
  `
  -- The attention tray: what wants the owner (a confirmation, a task waiting, a routine's news). ref points at the
  -- thing it is about, so a second notice for the same thing replaces the first while unread.
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    thread_id TEXT,
    ref TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notifications_unread ON notifications(read_at, created_at);
  CREATE INDEX notifications_ref ON notifications(kind, ref);
  `,
  `
  -- Commitments are tasks with a person on the other side: who owes whom. A due task is reminded once (reminded_at),
  -- again only if its date moves.
  ALTER TABLE tasks ADD COLUMN person_id TEXT;
  ALTER TABLE tasks ADD COLUMN owed_by TEXT;
  ALTER TABLE tasks ADD COLUMN reminded_at TEXT;
  CREATE INDEX tasks_due ON tasks(state, due_at);
  `,
  `
  -- Extensions the owner installed: a copy of the folder lives under the home; the manifest is kept as read then.
  CREATE TABLE extensions (
    id TEXT PRIMARY KEY,
    manifest TEXT NOT NULL,
    hash TEXT NOT NULL,
    dir TEXT NOT NULL,
    source TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  -- Outside apps the owner connected (Claude Code, Codex…): the token's sha256 only, never the token.
  CREATE TABLE api_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scopes TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
  `,
  `
  -- What the owner tells APX about a contact: a nickname, how they relate, rules for answering them (last in the
  -- prompt), whether they are silenced (stored, never answered) and what their chat may do (JSON flags, all off).
  ALTER TABLE persons ADD COLUMN nickname TEXT;
  ALTER TABLE persons ADD COLUMN relation TEXT;
  ALTER TABLE persons ADD COLUMN rules TEXT;
  ALTER TABLE persons ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE persons ADD COLUMN perms TEXT;
  `,
  `
  -- A routine can run the owner's commands around its agent: a pre-command whose output the agent reads, when to call
  -- the model given that output (always, if output, if it fails, never) and a post-command after.
  ALTER TABLE routines ADD COLUMN pre_command TEXT;
  ALTER TABLE routines ADD COLUMN post_command TEXT;
  ALTER TABLE routines ADD COLUMN call_model TEXT NOT NULL DEFAULT 'always';
  ALTER TABLE routine_runs ADD COLUMN model_called INTEGER;
  `,
  `
  -- A task's kind (a task, a commitment with someone, an errand for the way), its priority, free tags (JSON array) and
  -- its own reminder time (otherwise it is reminded when it is due). Tasks with a person were commitments already.
  ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';
  ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN remind_at TEXT;
  UPDATE tasks SET kind = 'commitment' WHERE person_id IS NOT NULL;
  CREATE INDEX tasks_remind ON tasks(state, remind_at);
  `,
  `
  -- An agent's activity (its runs, newest first) is read by agent.
  CREATE INDEX runs_agent ON runs(agent_id, created_at);
  `,
  `
  -- What a routine does each time: its agent answers the prompt, a fixed message reaches the owner (no model), or only
  -- its command runs.
  ALTER TABLE routines ADD COLUMN action TEXT NOT NULL DEFAULT 'agent';
  `,
  `
  -- A session with an outside engine itself (Claude Code, Codex, an ACP agent): its own prompt, no agent persona.
  ALTER TABLE threads ADD COLUMN engine TEXT;
  `,
  `
  -- A direct chat belongs to whoever owns its address now: chats left on a contact that was removed, or whose account
  -- was later linked as the owner's, follow the address.
  UPDATE threads SET person_id = (
    SELECT a.person_id FROM addresses a WHERE a.channel = threads.channel AND a.external_id = threads.conversation
  )
  WHERE person_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM addresses a
    WHERE a.channel = threads.channel AND a.external_id = threads.conversation AND a.person_id <> threads.person_id
  );
  `,
  `
  -- Words of every message, for search: only its text parts, kept by triggers; the text itself stays in messages.
  -- messages_n gives each message a stable number for the index (an implicit rowid may change on VACUUM).
  CREATE TABLE messages_n (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE);
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    text, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  INSERT INTO messages_n(id) SELECT id FROM messages ORDER BY created_at;
  INSERT INTO messages_fts(rowid, text)
    SELECT x.n, (SELECT group_concat(json_extract(p.value, '$.text'), ' ') FROM json_each(m.parts) p
      WHERE json_extract(p.value, '$.type') = 'text')
    FROM messages m JOIN messages_n x ON x.id = m.id;
  CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_n(id) VALUES (new.id);
    INSERT INTO messages_fts(rowid, text) VALUES (last_insert_rowid(), (SELECT group_concat(json_extract(p.value, '$.text'), ' ')
      FROM json_each(new.parts) p WHERE json_extract(p.value, '$.type') = 'text'));
  END;
  CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = (SELECT n FROM messages_n WHERE id = old.id);
    DELETE FROM messages_n WHERE id = old.id;
  END;
  CREATE TRIGGER messages_fts_au AFTER UPDATE OF parts ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = (SELECT n FROM messages_n WHERE id = old.id);
    INSERT INTO messages_fts(rowid, text) VALUES ((SELECT n FROM messages_n WHERE id = new.id),
      (SELECT group_concat(json_extract(p.value, '$.text'), ' ') FROM json_each(new.parts) p
        WHERE json_extract(p.value, '$.type') = 'text'));
  END;
  `,
  `
  -- The owner's own devices (a phone, another computer), paired with a one-time code: each has a token of its own,
  -- of which only the sha256 is kept, revocable without touching the others.
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT
  );
  `,
  `
  -- The interruption budget: every message APX meant to send the owner unasked, and what became of it. A routine may be
  -- an anchor (its news always arrives).
  CREATE TABLE nudges (
    n INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    thread_id TEXT,
    project_id TEXT,
    state TEXT NOT NULL,
    reason TEXT,
    exempt INTEGER NOT NULL DEFAULT 0,
    hold_until TEXT
  );
  CREATE INDEX nudges_at ON nudges(at);
  CREATE INDEX nudges_held ON nudges(state, hold_until);
  ALTER TABLE routines ADD COLUMN anchor INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Where a paired device takes push notices: {"kind":"expo","token":…} or {"kind":"unifiedpush","endpoint":…}.
  ALTER TABLE devices ADD COLUMN push TEXT;
  `,
  `
  -- A routine a profile seeded ("secretary:day-open"): the profile keeps it in step.
  ALTER TABLE routines ADD COLUMN origin TEXT;
  `,
  `
  -- The owner's 👍/👎 on a message APX sent unasked: a kind marked unhelpful again and again stops reaching them.
  ALTER TABLE nudges ADD COLUMN feedback TEXT;
  ALTER TABLE nudges ADD COLUMN feedback_at TEXT;
  `,
  `
  -- How a commitment ended (kept, missed, dropped), and how many times its date was moved by agreement.
  ALTER TABLE tasks ADD COLUMN outcome TEXT;
  ALTER TABLE tasks ADD COLUMN renegotiated INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- The secretary became one profile among others: its settings move to the running profile's values.
  INSERT INTO meta(key, value)
    SELECT 'setting:profile',
      json_object('id', CASE WHEN json_extract(value, '$.on') THEN 'secretary' ELSE NULL END,
                  'values', json(json_remove(value, '$.on')))
    FROM meta
    WHERE key = 'setting:secretary' AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'setting:profile');
  DELETE FROM meta WHERE key = 'setting:secretary';
  `,
  `
  -- The owner's own arrangement of chats: a name of theirs over the automatic title (NULL = automatic), pinned on top
  -- of its group, and archived out of the lists until unarchived.
  ALTER TABLE threads ADD COLUMN custom_title TEXT;
  ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Setup imports from v1 used to add every task and commitment again. A later copy goes only when nobody touched it:
  -- the same kind, project and title as the oldest, no event but its creation, nothing in its chat, same fields.
  CREATE TEMP TABLE import_dups AS
    WITH ranked AS (
      SELECT t.*, FIRST_VALUE(t.id) OVER (
        PARTITION BY t.kind, COALESCE(t.project_id, ''), t.title ORDER BY t.created_at, t.id
      ) AS kept_id
      FROM tasks t
    )
    SELECT d.id AS task_id, d.thread_id AS thread_id
    FROM ranked d JOIN tasks k ON k.id = d.kept_id
    WHERE d.id <> k.id
      AND d.status = k.status AND d.state = k.state AND d.description = k.description AND d.due_at IS k.due_at
      AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = d.id AND e.op <> 'create')
      AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = d.thread_id)
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.thread_id = d.thread_id)
      AND NOT EXISTS (SELECT 1 FROM threads s WHERE s.parent_id = d.thread_id)
      AND NOT EXISTS (SELECT 1 FROM media x WHERE x.thread_id = d.thread_id)
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.thread_id = d.thread_id);
  DELETE FROM notifications
    WHERE thread_id IN (SELECT thread_id FROM import_dups) OR (kind = 'task' AND ref IN (SELECT task_id FROM import_dups));
  DELETE FROM pending_inputs WHERE thread_id IN (SELECT thread_id FROM import_dups);
  DELETE FROM routine_runs WHERE thread_id IN (SELECT thread_id FROM import_dups);
  UPDATE memories SET thread_id = NULL WHERE thread_id IN (SELECT thread_id FROM import_dups);
  UPDATE surfaces SET thread_id = NULL WHERE thread_id IN (SELECT thread_id FROM import_dups);
  UPDATE outbox SET thread_id = NULL WHERE thread_id IN (SELECT thread_id FROM import_dups);
  UPDATE nudges SET thread_id = NULL WHERE thread_id IN (SELECT thread_id FROM import_dups);
  DELETE FROM task_events WHERE task_id IN (SELECT task_id FROM import_dups);
  DELETE FROM tasks WHERE id IN (SELECT task_id FROM import_dups);
  -- The model log and harness sessions cascade with the thread.
  DELETE FROM threads WHERE id IN (SELECT thread_id FROM import_dups);
  DROP TABLE import_dups;
  `,
  `ALTER TABLE projects ADD COLUMN registered INTEGER NOT NULL DEFAULT 1;`,
  // The origins a widget may read live data from (JSON array); none: it makes no requests at all.
  `ALTER TABLE surfaces ADD COLUMN connect TEXT;`,
  `ALTER TABLE pending_inputs ADD COLUMN approval TEXT;
   ALTER TABLE pending_inputs ADD COLUMN approval_scope TEXT;`,
];
