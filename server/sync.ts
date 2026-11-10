import type { CardRecord } from '../src/domain/types';
import { MAX_PAYLOAD_BYTES, PULL_LIMIT, type PullResponse, type PushResult } from '../src/sync/protocol';
import { SHARED_WITH } from './access';
import type { Database, Statement } from './db';
import { recordVersions, type Written } from './versions';

interface CardRow extends Omit<CardRecord, 'deleted'> {
  deleted: number;
}

const toRecord = (row: CardRow): CardRecord => ({ ...row, deleted: !!row.deleted });

/** Cards among `ids` shared with the user for editing. */
async function editableShares(db: Database, userId: string, ids: string[]): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT s.card_id FROM card_shares s WHERE s.role = 'edit' AND s.card_id IN (${ids.map(() => '?').join(',')}) AND ${SHARED_WITH}`)
    .bind(...ids, userId, userId)
    .all<{ card_id: string }>();
  return new Set(results.map((r) => r.card_id));
}

/**
 * A member who can edit both the old and new vault may write anything. Someone a card was
 * shared with for editing may change its content, but not move it, trash it, or create it.
 */
function mayWrite(record: CardRecord, current: CardRecord | undefined, writable: Set<string>, editable: Set<string>): boolean {
  if (writable.has(record.vault_id) && (!current || writable.has(current.vault_id))) return true;
  return !!current && editable.has(record.id) && record.vault_id === current.vault_id && record.deleted === current.deleted;
}

async function writableVaults(db: Database, userId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT vault_id FROM vault_members WHERE user_id = ? AND role IN ('owner', 'editor')`)
    .bind(userId)
    .all<{ vault_id: string }>();
  return new Set(results.map((r) => r.vault_id));
}

interface Write {
  record: CardRecord;
  /** The seq this write expects to replace, or null for a new card. */
  expected: number | null;
  result: (seq: number) => PushResult;
}

/**
 * Applies a batch of records. Decisions are made from a read, and each write only lands
 * if the card hasn't changed since. A write that lost that race comes back as `retry`.
 */
/** `via` names the AI app making the change, for its history; null for the person's own devices. */
export async function pushRecords(db: Database, userId: string, records: CardRecord[], via: string | null = null): Promise<PushResult[]> {
  const writable = await writableVaults(db, userId);
  const editable = await editableShares(db, userId, records.map((r) => r.id));
  const { results: rows } = await db
    .prepare(`SELECT id, vault_id, updated_at, deleted, seq, payload FROM cards WHERE id IN (${records.map(() => '?').join(',')})`)
    .bind(...records.map((r) => r.id))
    .all<CardRow>();
  const existing = new Map(rows.map((r) => [r.id, toRecord(r)]));

  const results = new Map<string, PushResult>();
  const writes: Write[] = [];
  for (const record of records) {
    const { id } = record;
    const current = existing.get(id);
    if (new TextEncoder().encode(record.payload).length > MAX_PAYLOAD_BYTES) {
      results.set(id, { id, status: 'too_large' });
    } else if (!mayWrite(record, current, writable, editable)) {
      results.set(id, { id, status: 'forbidden' });
    } else if (!current) {
      writes.push({ record, expected: null, result: (seq) => ({ id, status: 'ok', seq }) });
    } else if (current.seq === record.seq) {
      writes.push({ record, expected: current.seq, result: (seq) => ({ id, status: 'ok', seq }) });
    } else if (record.updated_at > current.updated_at) {
      writes.push({ record, expected: current.seq, result: (seq) => ({ id, status: 'conflict_client_won', seq, loser: current }) });
    } else {
      results.set(id, { id, status: 'conflict_server_won', server: current });
    }
  }

  if (writes.length) {
    const statements: Statement[] = [db.prepare(`UPDATE seq_counter SET value = value + ? WHERE id = 1`).bind(writes.length)];
    writes.forEach(({ record: r, expected }, i) => {
      const offset = writes.length - 1 - i;
      const seq = `(SELECT value FROM seq_counter WHERE id = 1) - ${offset}`;
      statements.push(
        expected === null
          ? db
              .prepare(
                `INSERT INTO cards (id, vault_id, updated_at, deleted, seq, payload) VALUES (?, ?, ?, ?, ${seq}, ?)
                 ON CONFLICT(id) DO NOTHING RETURNING seq`,
              )
              .bind(r.id, r.vault_id, r.updated_at, r.deleted ? 1 : 0, r.payload)
          : db
              .prepare(`UPDATE cards SET vault_id = ?, updated_at = ?, deleted = ?, seq = ${seq}, payload = ? WHERE id = ? AND seq = ? RETURNING seq`)
              .bind(r.vault_id, r.updated_at, r.deleted ? 1 : 0, r.payload, r.id, expected),
      );
    });
    const outcomes = await db.batch<{ seq: number }>(statements);
    const written: Written[] = [];
    writes.forEach((write, i) => {
      const row = outcomes[i + 1].results[0];
      const { id } = write.record;
      const result: PushResult = row ? write.result(row.seq) : { id, status: 'retry' };
      results.set(id, result);
      if (row) written.push({ record: write.record, previous: existing.get(id), conflict: result.status === 'conflict_client_won' });
    });
    // History is a convenience: a failure here must not fail a push that already landed.
    await recordVersions(db, userId, written, via).catch((err) => console.error('Could not record versions', err));
  }
  return records.map((r) => results.get(r.id)!);
}

export async function pullRecords(db: Database, userId: string, since: number): Promise<PullResponse> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.vault_id, c.updated_at, c.deleted, c.seq, c.payload FROM cards c
       WHERE c.seq > ?
         AND (c.vault_id IN (SELECT vault_id FROM vault_members WHERE user_id = ?)
              OR c.id IN (SELECT s.card_id FROM card_shares s WHERE ${SHARED_WITH}))
       ORDER BY c.seq LIMIT ?`,
    )
    .bind(since, userId, userId, userId, PULL_LIMIT + 1)
    .all<CardRow>();
  const more = results.length > PULL_LIMIT;
  const page = results.slice(0, PULL_LIMIT).map(toRecord);
  return { records: page, next: page.length ? page[page.length - 1].seq : since, more };
}
