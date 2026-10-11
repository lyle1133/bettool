CREATE TABLE IF NOT EXISTS learning_store (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  store_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO learning_store (id, revision, store_json, updated_at)
VALUES (
  1,
  0,
  '{"version":1,"cases":[],"unresolved":[],"metrics":{"confirmed":0,"corrected":0,"markedUnresolved":0,"exactHits":0,"retrievals":0}}',
  CURRENT_TIMESTAMP
);
