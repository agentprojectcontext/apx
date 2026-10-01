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
];
