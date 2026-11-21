-- Photos and files in an encrypted vault, sealed on the device (2026-11-21). The server and Drive keep bytes they
-- can't read, with no name, type, picture size or length: `sealed` says so, for the devices that open them.
ALTER TABLE attachments ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attachment_uploads ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0;
