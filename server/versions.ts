import type { CardRecord } from '../src/domain/types';
import type { VersionInfo, VersionResponse } from '../src/sync/protocol';
import type { Database, Statement } from './db';

/** Saves this close together, by one person through one app, extend the same version. */
export const VERSION_GAP = 10 * 60_000;
/** A version never covers more than this much editing time, so long sessions still leave steps. */
export const VERSION_SPAN = 60 * 60_000;
/** Oldest versions beyond this many per card are dropped. */
export const VERSION_LIMIT = 200;

interface VersionRow {
  id: number;
  card_id: string;
  author_id: string | null;
  started_at: number;
  saved_at: number;
  payload: string;
  sealed: number;
  via: string | null;
}

export interface Written {
  record: CardRecord;
  /** What the server held before this write, if anything. */
  previous?: CardRecord;
  /** The write replaced a version this device hadn't seen, so it must not be folded into it. */
  conflict: boolean;
}

/**
 * Adds each successful write to its card's history. The newest version always matches the card.
 * A card from before history was kept gets its earlier state saved first, with no author.
 */
export async function recordVersions(db: Database, userId: string, writes: Written[], via: string | null = null): Promise<void> {
  if (!writes.length) return;
  const ids = writes.map((w) => w.record.id);
  const { results } = await db
    .prepare(
      `SELECT v.id, v.card_id, v.author_id, v.started_at, v.saved_at, v.payload, v.sealed, v.via FROM card_versions v
       WHERE v.card_id IN (${ids.map(() => '?').join(',')})
         AND v.id = (SELECT MAX(id) FROM card_versions WHERE card_id = v.card_id)`,
    )
    .bind(...ids)
    .all<VersionRow>();
  const latest = new Map(results.map((r) => [r.card_id, r]));

  const statements: Statement[] = [];
  const insert = (cardId: string, author: string | null, at: number, payload: string, source: string | null) =>
    statements.push(
      db
        .prepare(`INSERT INTO card_versions (card_id, author_id, started_at, saved_at, payload, via) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(cardId, author, at, at, payload, source),
    );

  for (const { record, previous, conflict } of writes) {
    let last: Omit<VersionRow, 'id' | 'card_id'> | undefined = latest.get(record.id);
    if (!last && previous && previous.payload !== record.payload) {
      insert(record.id, null, previous.updated_at, previous.payload, null);
      last = { author_id: null, started_at: previous.updated_at, saved_at: previous.updated_at, payload: previous.payload, sealed: 0, via: null };
    }
    if (last?.payload === record.payload) continue;

    const at = record.updated_at;
    const extend =
      last &&
      latest.has(record.id) &&
      !conflict &&
      !last.sealed &&
      last.author_id === userId &&
      last.via === via &&
      at >= last.saved_at &&
      at - last.saved_at <= VERSION_GAP &&
      at - last.started_at <= VERSION_SPAN;
    if (extend) {
      statements.push(db.prepare(`UPDATE card_versions SET saved_at = ?, payload = ? WHERE id = ?`).bind(at, record.payload, latest.get(record.id)!.id));
    } else {
      insert(record.id, userId, at, record.payload, via);
      statements.push(
        db
          .prepare(
            `DELETE FROM card_versions WHERE card_id = ? AND id <= (SELECT id FROM card_versions WHERE card_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
          )
          .bind(record.id, record.id, VERSION_LIMIT),
      );
    }
  }
  if (statements.length) await db.batch(statements);
}

/** Closes the card's newest version, so the next change starts a new one. False if the user can't edit the card. */
export async function sealVersions(db: Database, userId: string, cardId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM cards c JOIN vault_members m ON m.vault_id = c.vault_id
       WHERE c.id = ? AND m.user_id = ? AND m.role IN ('owner', 'editor')`,
    )
    .bind(cardId, userId)
    .first<{ ok: number }>();
  if (!row) return false;
  await db
    .prepare(`UPDATE card_versions SET sealed = 1 WHERE id = (SELECT MAX(id) FROM card_versions WHERE card_id = ?)`)
    .bind(cardId)
    .run();
  return true;
}

/** True if the user can read the card now, through its current vault. */
async function canRead(db: Database, userId: string, cardId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM cards c JOIN vault_members m ON m.vault_id = c.vault_id WHERE c.id = ? AND m.user_id = ?`)
    .bind(cardId, userId)
    .first<{ ok: number }>();
  return !!row;
}

const INFO = `v.id, v.started_at, v.saved_at, u.name AS author, v.via`;

/** Newest first, or null if the card isn't readable by this user. */
export async function listVersions(db: Database, userId: string, cardId: string): Promise<VersionInfo[] | null> {
  if (!(await canRead(db, userId, cardId))) return null;
  const { results } = await db
    .prepare(`SELECT ${INFO} FROM card_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.card_id = ? ORDER BY v.id DESC`)
    .bind(cardId)
    .all<VersionInfo>();
  return results;
}

export async function getVersion(db: Database, userId: string, cardId: string, versionId: number): Promise<VersionResponse | null> {
  if (!(await canRead(db, userId, cardId))) return null;
  return db
    .prepare(`SELECT ${INFO}, v.payload FROM card_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.card_id = ? AND v.id = ?`)
    .bind(cardId, versionId)
    .first<VersionResponse>();
}
