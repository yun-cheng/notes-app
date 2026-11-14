import type { Database } from './db';

/**
 * Removes what has expired and can never be used again: sessions, one-time sign-in and pairing codes, Drive
 * connection attempts, and AI app grants whose refresh token ran out (with their access tokens). Run once a day.
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
  ]);
}
