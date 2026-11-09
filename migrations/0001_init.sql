CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  lock TEXT NOT NULL DEFAULT 'none' CHECK (lock IN ('none', 'pin')),
  ai_access TEXT NOT NULL DEFAULT 'off' CHECK (ai_access IN ('off', 'read', 'write')),
  created_at INTEGER NOT NULL
);

CREATE TABLE vault_members (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (vault_id, user_id)
);
CREATE INDEX vault_members_user ON vault_members(user_id);

-- Only these fields are visible to the server. `payload` is opaque.
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id),
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX cards_vault_seq ON cards(vault_id, seq);
CREATE INDEX cards_seq ON cards(seq);

-- A single counter, so `seq` increases across every vault.
CREATE TABLE seq_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);
INSERT INTO seq_counter (id, value) VALUES (1, 0);
