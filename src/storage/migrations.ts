/**
 * Ordered schema migrations. The array index + 1 is the schema version stored
 * in `PRAGMA user_version`. Never edit an existing entry; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: tasks, subtasks, events, approvals
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    goal TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    budget_usd REAL NOT NULL,
    spent_usd REAL NOT NULL DEFAULT 0,
    mode TEXT NOT NULL,
    cwd TEXT NOT NULL,
    assumptions TEXT NOT NULL DEFAULT '[]',
    plan TEXT,
    result_path TEXT,
    error TEXT
  );
  CREATE INDEX idx_tasks_created ON tasks(created_at DESC);

  CREATE TABLE subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    instructions TEXT NOT NULL,
    model TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    output TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    UNIQUE (task_id, key)
  );
  CREATE INDEX idx_subtasks_task ON subtasks(task_id, idx);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id TEXT,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT 'null'
  );
  CREATE INDEX idx_events_task ON events(task_id, id);

  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT 'null',
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT
  );
  CREATE INDEX idx_approvals_task ON approvals(task_id, status);
  `,
  // 2: evidence (sources and claims)
  `
  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    final_url TEXT NOT NULL,
    title TEXT,
    kind TEXT NOT NULL DEFAULT 'web',
    fetched_at TEXT NOT NULL,
    content_type TEXT,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    published_at TEXT,
    quality TEXT NOT NULL DEFAULT 'unrated',
    quality_reason TEXT,
    UNIQUE (task_id, final_url)
  );
  CREATE INDEX idx_sources_task ON sources(task_id);
  CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id TEXT,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT,
    quote TEXT,
    important INTEGER NOT NULL DEFAULT 0,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    quote_start INTEGER,
    quote_end INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    checks TEXT NOT NULL DEFAULT '[]',
    reason TEXT,
    UNIQUE (task_id, seq)
  );
  CREATE INDEX idx_claims_task ON claims(task_id, status);
  `,
  // 3: every address that led to a stored source (what the agent cited, each redirect hop, the final address)
  `
  CREATE TABLE source_aliases (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, url)
  );
  `,
];
