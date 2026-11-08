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
];
