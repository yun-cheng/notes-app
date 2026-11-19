-- How many seconds of voice each account had the server transcribe each day (server/transcribe.ts), for its daily
-- cap. Days are UTC dates (YYYY-MM-DD); the daily cleanup removes past ones.
CREATE TABLE transcription_seconds (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
