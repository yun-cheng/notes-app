-- A user's Google Drive connection. The server holds the refresh token so devices are never re-prompted.
CREATE TABLE drive_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_expires_at INTEGER,
  folder_id TEXT,
  connected_at INTEGER NOT NULL
);

-- One-time values tying Google's redirect back to the user who started connecting, since the
-- session cookie is SameSite=Strict and isn't sent on that redirect.
CREATE TABLE drive_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- A photo in a card. The file lives in the vault owner's Drive; the card's body refers to this ID.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  vault_id TEXT NOT NULL REFERENCES vaults(id),
  drive_file_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachments_vault ON attachments(vault_id);
