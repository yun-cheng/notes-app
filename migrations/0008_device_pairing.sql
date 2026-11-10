-- Signing in the native app through the system browser, where Google sign-in works.
-- The app starts a pairing and shows a short code; the person confirms the same code in a
-- signed-in browser; the app then claims a session of its own.
CREATE TABLE device_pairings (
  pair_hash TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
