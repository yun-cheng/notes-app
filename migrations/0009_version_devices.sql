-- The app-wide history lists versions across cards, and tells this device's changes from the others'.
-- A device makes up an ID for itself and says what it is ("Chrome on Mac"); AI apps and older apps leave both empty.
ALTER TABLE card_versions ADD COLUMN device TEXT;
ALTER TABLE card_versions ADD COLUMN device_name TEXT;
-- Whether the card was in the Trash at this version, so trashing and restoring are changes too.
-- NULL on versions from before this was kept.
ALTER TABLE card_versions ADD COLUMN deleted INTEGER;
CREATE INDEX card_versions_saved ON card_versions(saved_at, id);
