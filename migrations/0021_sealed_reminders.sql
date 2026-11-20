-- Reminders for todos in an encrypted vault (2026-11-21). The server can't read those, so a device with the vault
-- open works each one out and seals its notification for each of the account's browsers (RFC 8291), and the server
-- only sends it at `fire_at`, which is all it learns. A device replaces a vault's whole set as its todos change.
CREATE TABLE sealed_reminders (
  card_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  fire_at INTEGER NOT NULL,
  -- The push body, sealed for that browser, base64url.
  body TEXT NOT NULL,
  PRIMARY KEY (card_id, subscription_id)
);
CREATE INDEX sealed_reminders_vault ON sealed_reminders(vault_id);
CREATE INDEX sealed_reminders_fire ON sealed_reminders(fire_at);
