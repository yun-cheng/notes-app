import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_BYTES, PULL_LIMIT, PUSH_LIMIT } from '../src/sync/protocol';
import { pushRecords } from './sync';
import { rec, setup } from './testHarness';

describe('push and pull', () => {
  it('stores records, assigns increasing seq and pulls them in order', async () => {
    const { signIn, push, pull } = setup();
    const { cookie, vault } = await signIn('ann');
    const results = await push(cookie, [rec(vault, 'a'), rec(vault, 'b')]);
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
    const page = await pull(cookie);
    expect(page.records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.records[0].deleted).toBe(false);
    expect(page.records[1].seq).toBeGreaterThan(page.records[0].seq);
    expect(page.next).toBe(page.records[1].seq);
    expect((await pull(cookie, page.next)).records).toEqual([]);
  });
  it('fast-forwards when the base version is current', async () => {
    const { signIn, push, pull } = setup();
    const { cookie, vault } = await signIn('ann');
    const [first] = await push(cookie, [rec(vault, 'a')]);
    const seq = (first as { seq: number }).seq;
    const [second] = await push(cookie, [rec(vault, 'a', { seq, updated_at: 50, payload: 'v2' })]);
    expect(second.status).toBe('ok');
    expect((await pull(cookie)).records[0].payload).toBe('v2');
  });
  it('lets the newest win a conflict and reports the loser', async () => {
    const { signIn, push, pull } = setup();
    const { cookie, vault } = await signIn('ann');
    await push(cookie, [rec(vault, 'a', { updated_at: 100, payload: 'first' })]);

    const [newer] = await push(cookie, [rec(vault, 'a', { seq: 0, updated_at: 200, payload: 'newer' })]);
    expect(newer).toMatchObject({ status: 'conflict_client_won', loser: { payload: 'first' } });
    expect((await pull(cookie)).records[0].payload).toBe('newer');

    const [older] = await push(cookie, [rec(vault, 'a', { seq: 0, updated_at: 150, payload: 'older' })]);
    expect(older).toMatchObject({ status: 'conflict_server_won', server: { payload: 'newer' } });
    expect((await pull(cookie)).records[0].payload).toBe('newer');
  });
  it('asks for a retry when another write lands first', async () => {
    const { db, signIn, push } = setup();
    const { cookie, vault, user } = await signIn('ann');
    await push(cookie, [rec(vault, 'a')]);
    const realPrepare = db.prepare;
    let raced = false;
    db.prepare = (sql) => {
      // Moves the card on immediately after this push has read it.
      if (sql.includes('UPDATE seq_counter') && !raced) {
        raced = true;
        db.raw.exec(`UPDATE cards SET seq = 999 WHERE id = 'a'`);
      }
      return realPrepare(sql);
    };
    const [result] = await pushRecords(db, user.id, [rec(vault, 'a', { seq: 1, payload: 'late' })]);
    expect(result.status).toBe('retry');
    expect(db.raw.prepare(`SELECT payload FROM cards`).get()!.payload).toBe('payload-a');
  });
  it('rejects oversized payloads per record', async () => {
    const { signIn, push } = setup();
    const { cookie, vault } = await signIn('ann');
    const results = await push(cookie, [rec(vault, 'big', { payload: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) }), rec(vault, 'small')]);
    expect(results.map((r) => r.status)).toEqual(['too_large', 'ok']);
  });
  it('rejects malformed, duplicate and oversized batches', async () => {
    const { signIn, call } = setup();
    const { cookie, vault } = await signIn('ann');
    const post = (records: unknown) => call('/api/sync/push', { method: 'POST', body: JSON.stringify({ records }) }, cookie);
    expect((await post([{ id: 'x' }])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post('nope')).status).toBe(400);
    expect((await post([rec(vault, 'a'), rec(vault, 'a')])).status).toBe(400);
    expect((await post(Array.from({ length: PUSH_LIMIT + 1 }, (_, i) => rec(vault, `c${i}`)))).status).toBe(400);
    expect((await call('/api/sync/pull?since=-1', {}, cookie)).status).toBe(400);
  });
  it('pages through long histories', async () => {
    const { signIn, push, pull } = setup();
    const { cookie, vault } = await signIn('ann');
    for (let b = 0; b * PUSH_LIMIT < PULL_LIMIT + 5; b++) {
      await push(cookie, Array.from({ length: PUSH_LIMIT }, (_, i) => rec(vault, `c${b}-${i}`)));
    }
    const first = await pull(cookie);
    expect(first.records).toHaveLength(PULL_LIMIT);
    expect(first.more).toBe(true);
    const second = await pull(cookie, first.next);
    expect(second.more).toBe(false);
    expect(new Set([...first.records, ...second.records].map((r) => r.id)).size).toBe(first.records.length + second.records.length);
  });
});

describe('separation between accounts', () => {
  async function twoUsers() {
    const t = setup();
    const ann = await t.signIn('ann');
    const bob = await t.signIn('bob');
    await t.push(ann.cookie, [rec(ann.vault, 'ann-secret', { payload: 'private' })]);
    return { ...t, ann, bob };
  }
  it('gives each account its own vault', async () => {
    const { ann, bob } = await twoUsers();
    expect(ann.vault).not.toBe(bob.vault);
  });
  it('never pulls another account\'s cards', async () => {
    const { bob, pull } = await twoUsers();
    expect((await pull(bob.cookie)).records).toEqual([]);
  });
  it('refuses writes into another account\'s vault', async () => {
    const { ann, bob, push, pull } = await twoUsers();
    const [result] = await push(bob.cookie, [rec(ann.vault, 'planted')]);
    expect(result.status).toBe('forbidden');
    expect((await pull(ann.cookie)).records.map((r) => r.id)).toEqual(['ann-secret']);
  });
  it('refuses overwriting another account\'s card by ID, even from an owned vault', async () => {
    const { ann, bob, push, pull } = await twoUsers();
    const [result] = await push(bob.cookie, [rec(bob.vault, 'ann-secret', { updated_at: 999_999, payload: 'stolen' })]);
    expect(result).toEqual({ id: 'ann-secret', status: 'forbidden' });
    expect((await pull(ann.cookie)).records[0].payload).toBe('private');
    expect((await pull(bob.cookie)).records).toEqual([]);
  });
  it('does not let a viewer write', async () => {
    const { db, ann, bob, push, pull } = await twoUsers();
    db.raw.prepare(`INSERT INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'viewer')`).run(ann.vault, bob.user.id);
    expect((await pull(bob.cookie)).records.map((r) => r.id)).toEqual(['ann-secret']);
    const [result] = await push(bob.cookie, [rec(ann.vault, 'ann-secret', { seq: 1, updated_at: 999_999 })]);
    expect(result.status).toBe('forbidden');
  });
});
