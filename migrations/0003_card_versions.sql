-- Earlier states of each card, for the history page. `payload` is as opaque as the card's.
-- One row covers a stretch of edits by one person, so typing doesn't create a version per save.
-- A sealed row is never extended, so the next change starts a new version (used before a restore).
CREATE TABLE card_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  sealed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX card_versions_card ON card_versions(card_id, id);
