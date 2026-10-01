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
];
