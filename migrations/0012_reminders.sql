-- Due-date reminders by web push (server/reminders.ts).

-- A browser that asked for reminders: where to push them, and when this person wants them.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- An IANA time zone, like Asia/Taipei: due dates are local days.
  time_zone TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  -- When a todo with a date but no time reminds, local (HH:MM).
  remind_at TEXT NOT NULL DEFAULT '09:00',
  -- How long before a todo's due time it reminds.
  lead_minutes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

-- Open todos with a due date, kept as cards are pushed. Only from vaults the server can read: an encrypted vault's
-- todos have no reminders.
CREATE TABLE reminders (
  card_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due TEXT NOT NULL,
  due_time TEXT
);
CREATE INDEX reminders_due ON reminders(due);

-- What has been sent, so each reminds once per browser; a new due date is a new reminder.
CREATE TABLE reminders_sent (
  card_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  due_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, subscription_id, due_key)
);
