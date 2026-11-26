-- Account-level default AI access for open vaults, with optional per-vault overrides (2026-11-27).
-- Private or encrypted vaults are always off. Existing non-off vaults keep their explicit choice as an override.
ALTER TABLE users ADD COLUMN ai_default_access TEXT NOT NULL DEFAULT 'off' CHECK (ai_default_access IN ('off', 'read', 'write'));
ALTER TABLE vaults ADD COLUMN ai_access_override TEXT CHECK (ai_access_override IN ('off', 'read', 'write'));
UPDATE vaults SET ai_access_override = ai_access WHERE ai_access != 'off' AND lock = 'none' AND encryption IS NULL;
