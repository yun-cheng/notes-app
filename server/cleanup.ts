import type { Database } from './db';
import { DRAFT_DAYS } from './drafts';
import { utcDay } from './translate';

/**
 * Removes what has expired and can never be used again: sessions, one-time sign-in and pairing codes, Drive
 * connection attempts, AI app grants whose refresh token ran out (with their access tokens), the record of
 * reminders sent a week ago, translation counts for days gone by, drafts left 30 days, and uploads of big files
 * left unfinished a week. Run once a day.
 * Public links are left: their page says when one has expired.
 */
export async function removeExpired(db: Database, now: number): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM oauth_codes WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM oauth_tokens WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM oauth_grants WHERE refresh_expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM drive_states WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM device_pairings WHERE expires_at < ?`).bind(now),
    // A reminder sent more than a week ago won't be due again.
    db.prepare(`DELETE FROM reminders_sent WHERE sent_at < ?`).bind(now - 7 * 86_400_000),
    // Only today's count limits anything; yesterday's is kept for a day, in case of clocks near midnight.
    db.prepare(`DELETE FROM translation_counts WHERE day < ?`).bind(utcDay(now - 86_400_000)),
    db.prepare(`DELETE FROM drafts WHERE updated_at < ?`).bind(now - DRAFT_DAYS * 86_400_000),
    // Drive keeps a resumable upload's session for a week.
    db.prepare(`DELETE FROM attachment_uploads WHERE created_at < ?`).bind(now - 7 * 86_400_000),
  ]);
}
