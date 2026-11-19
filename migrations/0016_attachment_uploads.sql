-- Uploads of a big file (a video) under way, in pieces (server/photos.ts): Google Drive's resumable upload session
-- for each, which only the server knows, so a device can go on from the last piece Drive has after a lost
-- connection or a day away. The row goes once the upload is done; the daily cleanup removes those a week old, as
-- Drive forgets the session by then.
CREATE TABLE attachment_uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  session_url TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachment_uploads_by_time ON attachment_uploads (created_at);
