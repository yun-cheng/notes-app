-- A photo, video or file shared from Google Drive (server/photos.ts): its Drive link, which anyone with it can open,
-- while it's shared; none once sharing stops or before it starts.
ALTER TABLE attachments ADD COLUMN drive_link TEXT;
