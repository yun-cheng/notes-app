-- Earlier states of each card, for the history page. `payload` is as opaque as the card's.
-- One row covers a stretch of edits by one person, so typing doesn't create a version per save.
CREATE TABLE card_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX card_versions_card ON card_versions(card_id, id);
