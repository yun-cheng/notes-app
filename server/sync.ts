import type { CardRecord } from '../src/domain/types';
import { MAX_PAYLOAD_BYTES, PULL_LIMIT, type PullResponse, type PushResult } from '../src/sync/protocol';
import type { Database, Statement } from './db';
import { recordVersions, type Written } from './versions';

interface CardRow extends Omit<CardRecord, 'deleted'> {
  deleted: number;
}

const toRecord = (row: CardRow): CardRecord => ({ ...row, deleted: !!row.deleted });

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
export async function pushRecords(db: Database, userId: string, records: CardRecord[]): Promise<PushResult[]> {
  const writable = await writableVaults(db, userId);
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
    } else if (!writable.has(record.vault_id) || (current && !writable.has(current.vault_id))) {
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
    await recordVersions(db, userId, written).catch((err) => console.error('Could not record versions', err));
  }
  return records.map((r) => results.get(r.id)!);
}

export async function pullRecords(db: Database, userId: string, since: number): Promise<PullResponse> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.vault_id, c.updated_at, c.deleted, c.seq, c.payload
       FROM cards c JOIN vault_members m ON m.vault_id = c.vault_id
       WHERE m.user_id = ? AND c.seq > ? ORDER BY c.seq LIMIT ?`,
    )
    .bind(userId, since, PULL_LIMIT + 1)
    .all<CardRow>();
  const more = results.length > PULL_LIMIT;
  const page = results.slice(0, PULL_LIMIT).map(toRecord);
  return { records: page, next: page.length ? page[page.length - 1].seq : since, more };
}
