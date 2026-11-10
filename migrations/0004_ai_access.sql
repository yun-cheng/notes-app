-- AI apps connect over MCP with OAuth. Clients register themselves; the owner approves each one once.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array
  created_at INTEGER NOT NULL
);

-- One-time codes from an approval, exchanged for tokens within minutes. Only hashes are stored.
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- An app the user approved. Deleting it revokes every token it holds.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  refresh_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_grants_user ON oauth_grants(user_id);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);

-- The AI app that made a version, or null when the person edited it themselves.
ALTER TABLE card_versions ADD COLUMN via TEXT;
