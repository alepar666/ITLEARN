CREATE TABLE IF NOT EXISTS sync_profiles (
  code_hash TEXT PRIMARY KEY,
  progress_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
