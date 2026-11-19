-- A photo or file no entry holds any more waits in the Trash (src/photos/keeper.ts): when it was found so, and the
-- entry it was last in, to put it back there. After 30 days a device deletes it, from Drive too.
ALTER TABLE attachments ADD COLUMN trashed_at INTEGER;
ALTER TABLE attachments ADD COLUMN trashed_from TEXT;
-- A file's name as it was attached, for the Trash to show and to put it back with. Drive's copy is named with it already.
ALTER TABLE attachments ADD COLUMN name TEXT;
