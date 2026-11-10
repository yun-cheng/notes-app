-- Invitations to a vault for people who haven't signed in yet. Applied at their first sign-in.
CREATE TABLE vault_invites (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, email)
);
CREATE INDEX vault_invites_email ON vault_invites(email);

-- A single card shared beyond its vault: with one person, or with everyone in another vault.
CREATE TABLE card_shares (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'vault')),
  target_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
  shared_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, target_type, target_id)
);
CREATE INDEX card_shares_target ON card_shares(target_type, target_id);

-- A card shared with an email address that has no account yet.
CREATE TABLE card_share_invites (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
  shared_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, email)
);
CREATE INDEX card_share_invites_email ON card_share_invites(email);

-- "Anyone with the link": read only, unlisted, optionally expiring, revocable.
CREATE TABLE public_links (
  token TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX public_links_card ON public_links(card_id);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX comments_card ON comments(card_id, created_at);
