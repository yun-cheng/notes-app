-- A vault's PIN lock is each member's own (2026-11-21). The owner's stays on the vault, beside the encryption it
-- wraps; anyone else's is on their membership, with whether it hides the vault. An owner may ask every member to
-- lock it with a PIN of their own before they see anything in it.
ALTER TABLE vault_members ADD COLUMN pin_salt TEXT;
ALTER TABLE vault_members ADD COLUMN pin_hash TEXT;
ALTER TABLE vault_members ADD COLUMN pin_iterations INTEGER;
ALTER TABLE vault_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vaults ADD COLUMN members_need_pin INTEGER NOT NULL DEFAULT 0;

-- The memberships that reach a vault's cards now: all but those of members still without the PIN their owner asks for.
CREATE VIEW vault_access AS
  SELECT m.vault_id, m.user_id, m.role FROM vault_members m JOIN vaults v ON v.id = m.vault_id
  WHERE NOT (v.members_need_pin = 1 AND m.role != 'owner' AND m.pin_hash IS NULL);
