-- A video's length in seconds, as the device that added it read it (server/photos.ts), kept with its width and
-- height so the Trash can show it and a video put back from there keeps it on its block.
ALTER TABLE attachments ADD COLUMN duration REAL;
ALTER TABLE attachment_uploads ADD COLUMN duration REAL;
