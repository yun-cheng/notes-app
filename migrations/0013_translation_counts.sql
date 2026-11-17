-- How many entries each account had the server translate each day (server/translate.ts), for its daily cap.
-- Days are UTC dates (YYYY-MM-DD); the daily cleanup removes past ones.
CREATE TABLE translation_counts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
