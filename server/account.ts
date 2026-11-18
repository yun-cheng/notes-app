import type { Database } from './db';
import type { DriveConfig } from './drive';
import type { AccountSummary } from '../src/sync/protocol';

/** What deleting this account would take, for the confirmation: its own vaults, and the vaults of others it's in. */
export async function accountSummary(db: Database, userId: string): Promise<AccountSummary> {
  const owned = await db
    .prepare(
      `SELECT v.id, v.name,
              (SELECT COUNT(*) FROM cards c WHERE c.vault_id = v.id AND c.deleted = 0) AS cards,
              (SELECT COUNT(*) FROM vault_members m WHERE m.vault_id = v.id AND m.user_id != v.owner_id) AS others
       FROM vaults v WHERE v.owner_id = ? ORDER BY v.created_at`,
    )
    .bind(userId)
    .all<{ id: string; name: string; cards: number; others: number }>();
  const joined = await db
    .prepare(`SELECT COUNT(*) AS n FROM vault_members m JOIN vaults v ON v.id = m.vault_id WHERE m.user_id = ? AND v.owner_id != ?`)
    .bind(userId, userId)
    .first<{ n: number }>();
  return { vaults: owned.results, joined: joined?.n ?? 0 };
}

/**
 * Deletes an account and everything it owns, all at once or not at all: its vaults with their entries, history,
 * comments, shares and public links (so people they're shared with lose them too, at their next sync), its place
 * in other people's vaults, its comments and the shares and links it made there, its sessions, AI app and device
 * connections, reminders and Drive connection. Entries it wrote in someone else's vault stay there, as that
 * vault's, with their history no longer naming it. Photos stay in its Google Drive, where it can delete them, and
 * the app's access to them is given back to Google.
 */
export async function deleteAccount(db: Database, drive: DriveConfig | null, userId: string): Promise<void> {
  const token = await db.prepare(`SELECT refresh_token FROM drive_accounts WHERE user_id = ?`).bind(userId).first<{ refresh_token: string }>();
  const owned = `(SELECT id FROM vaults WHERE owner_id = ?1)`;
  await db.batch(
    [
      `DELETE FROM reminders WHERE vault_id IN ${owned}`,
      `DELETE FROM attachments WHERE owner_id = ?1 OR vault_id IN ${owned}`,
      // Cards from elsewhere shared into its vaults stop being shared there.
      `DELETE FROM card_shares WHERE target_type = 'vault' AND target_id IN ${owned}`,
      // With each card go its versions, shares, invites, public links, comments and moves.
      `DELETE FROM cards WHERE vault_id IN ${owned}`,
      // With each vault go its members and invites.
      `DELETE FROM vaults WHERE owner_id = ?1`,
      // What it left in other people's vaults.
      `DELETE FROM comments WHERE author_id = ?1`,
      `DELETE FROM card_shares WHERE shared_by = ?1 OR (target_type = 'user' AND target_id = ?1)`,
      `DELETE FROM card_share_invites WHERE shared_by = ?1`,
      `DELETE FROM public_links WHERE created_by = ?1`,
      `DELETE FROM vault_invites WHERE invited_by = ?1`,
      // With the user go its sessions, memberships, AI app grants, Drive connection, device pairings, browsers
      // for reminders and translation counts; its versions in other vaults keep their words without its name.
      `DELETE FROM users WHERE id = ?1`,
    ].map((sql) => db.prepare(sql).bind(userId)),
  );
  if (token && drive) {
    // Best effort: the app keeps nothing that could use it either way.
    await drive.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refresh_token)}`, { method: 'POST' }).catch(() => undefined);
  }
}
