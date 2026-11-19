-- What an account has written but not yet sent (server/drafts.ts): the journal box's, one for each view of the
-- journal, and a comment's, one for each entry, so another device opens with it as it was left. `body` is the draft
-- as JSON, or NULL once sent or emptied, so an older copy on a device that was offline can't bring it back. The
-- server's clock orders them: the last to arrive wins. The daily cleanup removes those 30 days old.
CREATE TABLE drafts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);
CREATE INDEX drafts_by_time ON drafts (user_id, updated_at);
