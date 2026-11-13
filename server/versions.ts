import type { CardRecord } from '../src/domain/types';
import type { RecentVersion, RecentVersionsResponse, VersionInfo, VersionResponse } from '../src/sync/protocol';
import { allows, cardAccess, SHARED_WITH } from './access';
import type { Database, Statement } from './db';

/** Saves this close together, by one person on one device or through one app, extend the same version. */
export const VERSION_GAP = 10 * 60_000;
/** A version never covers more than this much editing time, so long sessions still leave steps. */
export const VERSION_SPAN = 60 * 60_000;
/** Oldest versions beyond this many per card are dropped. */
export const VERSION_LIMIT = 200;
/** How many versions a page of the app-wide history holds, and roughly how much card text. */
export const RECENT_LIMIT = 40;
const RECENT_BYTES = 1_500_000;

/** The device a write came from: an ID it made up for itself, and what it calls itself. */
export interface Device {
  id: string;
  name: string | null;
}

interface VersionRow {
  id: number;
  card_id: string;
  author_id: string | null;
  started_at: number;
  saved_at: number;
  payload: string;
  sealed: number;
  via: string | null;
  device: string | null;
  /** Whether the card was in the Trash. Null on versions from before that was kept. */
  deleted: number | null;
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
 * `via` names the AI app that made the write, `device` the device; an AI app has no device.
 */
export async function recordVersions(
  db: Database,
  userId: string,
  writes: Written[],
  via: string | null = null,
  device: Device | null = null,
): Promise<void> {
  if (!writes.length) return;
  const ids = writes.map((w) => w.record.id);
  const { results } = await db
    .prepare(
      `SELECT v.id, v.card_id, v.author_id, v.started_at, v.saved_at, v.payload, v.sealed, v.via, v.device, v.deleted FROM card_versions v
       WHERE v.card_id IN (${ids.map(() => '?').join(',')})
         AND v.id = (SELECT MAX(id) FROM card_versions WHERE card_id = v.card_id)`,
    )
    .bind(...ids)
    .all<VersionRow>();
  const latest = new Map(results.map((r) => [r.card_id, r]));
  const from = device?.id ?? null;

  const statements: Statement[] = [];
  const insert = (cardId: string, author: string | null, at: number, payload: string, trashed: number, made: { via: string | null; device: Device | null }) =>
    statements.push(
      db
        .prepare(
          `INSERT INTO card_versions (card_id, author_id, started_at, saved_at, payload, via, device, device_name, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(cardId, author, at, at, payload, made.via, made.device?.id ?? null, made.device?.name ?? null, trashed),
    );

  for (const { record, previous, conflict } of writes) {
    const stored = latest.get(record.id);
    const trashed = record.deleted ? 1 : 0;
    // Where the card was before this write: as its newest version says, or the card itself where the version doesn't.
    const was = stored?.deleted ?? (previous?.deleted ? 1 : 0);
    let last: Pick<VersionRow, 'author_id' | 'started_at' | 'saved_at' | 'payload' | 'sealed' | 'via' | 'device'> | undefined = stored;
    if (!last && previous && (previous.payload !== record.payload || was !== trashed)) {
      insert(record.id, null, previous.updated_at, previous.payload, was, { via: null, device: null });
      last = { author_id: null, started_at: previous.updated_at, saved_at: previous.updated_at, payload: previous.payload, sealed: 0, via: null, device: null };
    }
    if (last?.payload === record.payload && was === trashed) continue;

    const at = record.updated_at;
    const extend =
      stored &&
      !conflict &&
      !stored.sealed &&
      stored.author_id === userId &&
      stored.via === via &&
      stored.device === from &&
      // Moving a card to the Trash, or back, is a step of its own.
      was === trashed &&
      at >= stored.saved_at &&
      at - stored.saved_at <= VERSION_GAP &&
      at - stored.started_at <= VERSION_SPAN;
    if (extend) {
      statements.push(db.prepare(`UPDATE card_versions SET saved_at = ?, payload = ?, deleted = ? WHERE id = ?`).bind(at, record.payload, trashed, stored.id));
    } else {
      if (stored && stored.deleted === null) statements.push(db.prepare(`UPDATE card_versions SET deleted = ? WHERE id = ?`).bind(was, stored.id));
      insert(record.id, userId, at, record.payload, trashed, { via, device });
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
  if (!allows(await cardAccess(db, userId, cardId), 'write')) return false;
  await db
    .prepare(`UPDATE card_versions SET sealed = 1 WHERE id = (SELECT MAX(id) FROM card_versions WHERE card_id = ?)`)
    .bind(cardId)
    .run();
  return true;
}

/** True if the user can read the card now, through its vault or a share. */
async function canRead(db: Database, userId: string, cardId: string): Promise<boolean> {
  return !!(await cardAccess(db, userId, cardId));
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

interface RecentRow extends VersionInfo {
  card_id: string;
  vault_id: string;
  author_id: string;
  payload: string;
  deleted: number | null;
  device: string | null;
  device_name: string | null;
  before_id: number | null;
  before_payload: string | null;
  before_deleted: number | null;
  /** How many versions the card has. */
  kept: number;
}

/** Where a page of recent versions ends: `saved_at` and `id` of its last one. */
const CURSOR = /^(\d{1,16})-(\d{1,16})$/;

/**
 * The newest versions of every card the user can read, each with the version it replaced: what changed lately, on
 * any device, by anyone, through any AI app. `device` is the asking device's ID, to mark its own versions.
 * `before` is the `next` of the page before. Null if `before` isn't one.
 */
export async function listRecentVersions(db: Database, userId: string, device: string | null, before: string | null): Promise<RecentVersionsResponse | null> {
  const cursor = before === null ? null : CURSOR.exec(before);
  if (before !== null && !cursor) return null;
  const [at, id] = cursor ? [Number(cursor[1]), Number(cursor[2])] : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  // A card's state from before history was kept has no author. It is what the next version replaced, not a change.
  const { results } = await db
    .prepare(
      `SELECT ${INFO}, v.card_id, c.vault_id, v.author_id, v.payload, v.deleted, v.device, v.device_name,
              p.id AS before_id, p.payload AS before_payload, p.deleted AS before_deleted,
              (SELECT COUNT(*) FROM card_versions WHERE card_id = v.card_id) AS kept
       FROM card_versions v
       JOIN cards c ON c.id = v.card_id
       JOIN users u ON u.id = v.author_id
       LEFT JOIN card_versions p ON p.id = (SELECT MAX(id) FROM card_versions WHERE card_id = v.card_id AND id < v.id)
       WHERE (v.saved_at < ? OR (v.saved_at = ? AND v.id < ?))
         AND (c.vault_id IN (SELECT vault_id FROM vault_members WHERE user_id = ?)
              OR c.id IN (SELECT s.card_id FROM card_shares s WHERE ${SHARED_WITH}))
       ORDER BY v.saved_at DESC, v.id DESC LIMIT ?`,
    )
    .bind(at, at, id, userId, userId, userId, RECENT_LIMIT + 1)
    .all<RecentRow>();

  const versions: RecentVersion[] = [];
  let bytes = 0;
  let read = 0;
  for (const row of results.slice(0, RECENT_LIMIT)) {
    bytes += row.payload.length + (row.before_payload?.length ?? 0);
    // Long entries make for a short page, but never an empty one.
    if (read && bytes > RECENT_BYTES) break;
    read++;
    // The oldest version left of a card that has had its oldest dropped: what it changed is gone.
    if (row.before_id === null && row.kept >= VERSION_LIMIT) continue;
    const mine = row.author_id === userId;
    versions.push({
      id: row.id,
      started_at: row.started_at,
      saved_at: row.saved_at,
      author: row.author,
      via: row.via,
      card_id: row.card_id,
      vault_id: row.vault_id,
      payload: row.payload,
      deleted: !!row.deleted,
      before: row.before_id === null ? null : { payload: row.before_payload!, deleted: !!row.before_deleted },
      mine,
      // Other people's devices are their own business.
      device: mine && row.device ? { here: row.device === device, name: row.device_name } : null,
    });
  }
  const last = results[read - 1];
  return { versions, next: last && read < results.length ? `${last.saved_at}-${last.id}` : null };
}
