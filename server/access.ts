import type { SharedCard } from '../src/sync/protocol';
import type { Database } from './db';

/**
 * Who can do what with a card. A person reaches a card through its vault (owner, editor or
 * viewer), or through a share of that one card (to them, or to a vault they belong to).
 *
 * - read: see it
 * - comment: also comment on it (vault viewers, and shares with comment access)
 * - write: also edit it (vault owners and editors, and shares with edit access)
 */
export type AccessLevel = 'read' | 'comment' | 'write';

const RANK: Record<AccessLevel, number> = { read: 1, comment: 2, write: 3 };
const VAULT_LEVEL: Record<string, AccessLevel> = { owner: 'write', editor: 'write', viewer: 'comment' };
const SHARE_LEVEL: Record<string, AccessLevel> = { edit: 'write', comment: 'comment', view: 'read' };

export interface CardAccess {
  level: AccessLevel;
  /** True when access comes from the card's own vault, which is needed to share or move it. */
  member: boolean;
}

/** SQL matching shares that reach `?` (the user, bound twice): directly, or through a vault they belong to. */
export const SHARED_WITH = `((s.target_type = 'user' AND s.target_id = ?) OR (s.target_type = 'vault' AND s.target_id IN (SELECT vault_id FROM vault_members WHERE user_id = ?)))`;

export async function cardAccess(db: Database, userId: string, cardId: string): Promise<CardAccess | null> {
  const [member, shares] = await Promise.all([
    db
      .prepare(`SELECT m.role FROM cards c JOIN vault_members m ON m.vault_id = c.vault_id AND m.user_id = ? WHERE c.id = ?`)
      .bind(userId, cardId)
      .first<{ role: string }>(),
    db.prepare(`SELECT s.role FROM card_shares s WHERE s.card_id = ? AND ${SHARED_WITH}`).bind(cardId, userId, userId).all<{ role: string }>(),
  ]);
  let best: AccessLevel | null = member ? VAULT_LEVEL[member.role] : null;
  for (const { role } of shares.results) {
    const level = SHARE_LEVEL[role];
    if (!best || RANK[level] > RANK[best]) best = level;
  }
  return best ? { level: best, member: !!member } : null;
}

export const allows = (access: CardAccess | null, need: AccessLevel) => !!access && RANK[access.level] >= RANK[need];

/** Cards shared with the user outside their own vaults, with the strongest role each. */
export async function sharedWith(db: Database, userId: string): Promise<SharedCard[]> {
  const { results } = await db
    .prepare(
      `SELECT s.card_id, s.role, u.name AS shared_by FROM card_shares s JOIN users u ON u.id = s.shared_by
       WHERE ${SHARED_WITH}
         AND s.card_id NOT IN (SELECT c.id FROM cards c JOIN vault_members m ON m.vault_id = c.vault_id WHERE m.user_id = ?)`,
    )
    .bind(userId, userId, userId)
    .all<SharedCard>();
  const best = new Map<string, SharedCard>();
  const rank = { view: 1, comment: 2, edit: 3 };
  for (const share of results) {
    const seen = best.get(share.card_id);
    if (!seen || rank[share.role] > rank[seen.role]) best.set(share.card_id, share);
  }
  return [...best.values()];
}
