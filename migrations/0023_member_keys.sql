-- An encrypted vault can be shared (2026-11-22). Its key reaches each member sealed for them alone: their device makes
-- a key pair, keeps the private half wrapped under the member's own PIN (`encryption`, opaque to the server), and the
-- owner's device, once the owner lets them in, seals the vault key to the public half (`key_grant`). Until then the
-- server sends them nothing in the vault, as it doesn't for a member without the PIN their owner asks for.
ALTER TABLE vault_members ADD COLUMN encryption TEXT;
ALTER TABLE vault_members ADD COLUMN key_grant TEXT;

DROP VIEW vault_access;
CREATE VIEW vault_access AS
  SELECT m.vault_id, m.user_id, m.role FROM vault_members m JOIN vaults v ON v.id = m.vault_id
  WHERE m.role = 'owner' OR NOT ((v.members_need_pin = 1 AND m.pin_hash IS NULL) OR (v.encryption IS NOT NULL AND m.key_grant IS NULL));
