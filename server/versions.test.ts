import { describe, expect, it } from 'vitest';
import type { PushResult, RecentVersionsResponse, VersionResponse, VersionsResponse } from '../src/sync/protocol';
import { pushRecords } from './sync';
import { rec, setup } from './testHarness';
import { RECENT_LIMIT, recordVersions, VERSION_GAP, VERSION_LIMIT, VERSION_SPAN } from './versions';

const MIN = 60_000;
const seqOf = (r: PushResult) => (r as { seq: number }).seq;

function historyApi() {
  const t = setup();
  const list = async (cookie: string, id: string) => {
    const res = await t.call(`/api/cards/${id}/versions`, {}, cookie);
    return { status: res.status, versions: res.ok ? ((await res.json()) as VersionsResponse).versions : [] };
  };
  const get = async (cookie: string, id: string, version: number | string) => {
    const res = await t.call(`/api/cards/${id}/versions/${version}`, {}, cookie);
    return { status: res.status, version: res.ok ? ((await res.json()) as VersionResponse) : null };
  };
  /** Pushes successive payloads of one card, each at the given time. */
  const edit = async (cookie: string, vault: string, id: string, steps: [number, string][]) => {
    let seq = 0;
    for (const [at, payload] of steps) seq = seqOf((await t.push(cookie, [rec(vault, id, { seq, updated_at: at, payload })]))[0]);
    return seq;
  };
  /** Pushes as a device that says which it is. */
  const pushFrom = async (cookie: string, device: string, records: Parameters<typeof t.push>[1], name = '') => {
    const headers = { 'X-Device-Id': device, ...(name ? { 'X-Device-Name': name } : {}) };
    const res = await t.call('/api/sync/push', { method: 'POST', body: JSON.stringify({ records }), headers }, cookie);
    return ((await res.json()) as { results: PushResult[] }).results;
  };
  /** A page of the app-wide history, asked for by a device. */
  const recent = async (cookie: string, device?: string, before?: string) => {
    const res = await t.call(`/api/versions${before ? `?before=${before}` : ''}`, device ? { headers: { 'X-Device-Id': device } } : {}, cookie);
    return { status: res.status, ...(res.ok ? ((await res.json()) as RecentVersionsResponse) : { versions: [], next: null }) };
  };
  return { ...t, list, get, edit, pushFrom, recent };
}

const LAPTOP = 'laptop-0001';
const PHONE = 'phone-0001';

describe('card history', () => {
  it('folds close saves into one version that matches the card', async () => {
    const { signIn, edit, list, get } = historyApi();
    const { cookie, vault } = await signIn('ann');
    await edit(cookie, vault, 'a', [[0, 'h'], [MIN, 'he'], [2 * MIN, 'hello']]);
    const { versions } = await list(cookie, 'a');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ started_at: 0, saved_at: 2 * MIN, author: 'ann' });
    expect((await get(cookie, 'a', versions[0].id)).version?.payload).toBe('hello');
  });
  it('starts a new version after a pause, or after a long session', async () => {
    const { signIn, edit, list } = historyApi();
    const { cookie, vault } = await signIn('ann');
    await edit(cookie, vault, 'a', [[0, 'one'], [VERSION_GAP + MIN, 'two']]);
    expect((await list(cookie, 'a')).versions.map((v) => v.saved_at)).toEqual([VERSION_GAP + MIN, 0]);

    const steady = Array.from({ length: Math.ceil(VERSION_SPAN / (5 * MIN)) + 2 }, (_, i) => [i * 5 * MIN, `b${i}`] as [number, string]);
    await edit(cookie, vault, 'b', steady);
    expect((await list(cookie, 'b')).versions).toHaveLength(2);
  });
  it('starts a new version after the newest is sealed', async () => {
    const { signIn, call, edit, push, list } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const seq = await edit(cookie, vault, 'a', [[0, 'draft']]);
    expect((await call('/api/cards/a/versions/seal', { method: 'POST' }, cookie)).status).toBe(200);
    await push(cookie, [rec(vault, 'a', { seq, updated_at: MIN, payload: 'restored' })]);
    expect((await list(cookie, 'a')).versions).toHaveLength(2);
  });
  it('only lets editors seal', async () => {
    const { db, signIn, call, edit } = historyApi();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    await edit(ann.cookie, ann.vault, 'a', [[0, 'x']]);
    expect((await call('/api/cards/a/versions/seal', { method: 'POST' }, ben.cookie)).status).toBe(404);
    db.raw.exec(`INSERT INTO vault_members (vault_id, user_id, role) VALUES ('${ann.vault}', '${ben.user.id}', 'viewer')`);
    expect((await call('/api/cards/a/versions/seal', { method: 'POST' }, ben.cookie)).status).toBe(404);
  });
  it('skips writes that leave the card as it was', async () => {
    const { signIn, push, edit, list } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const seq = await edit(cookie, vault, 'a', [[0, 'same']]);
    await push(cookie, [rec(vault, 'a', { seq, updated_at: VERSION_GAP * 3, payload: 'same' })]);
    expect((await list(cookie, 'a')).versions).toHaveLength(1);
  });
  it('keeps moving a card to the Trash, and back, as versions of their own', async () => {
    const { signIn, push, edit, recent } = historyApi();
    const { cookie, vault } = await signIn('ann');
    let seq = await edit(cookie, vault, 'a', [[0, 'text']]);
    // Right after the edit, where a change to the text would have joined it.
    seq = seqOf((await push(cookie, [rec(vault, 'a', { seq, updated_at: MIN, payload: 'text', deleted: true })]))[0]);
    await push(cookie, [rec(vault, 'a', { seq, updated_at: 2 * MIN, payload: 'text' })]);
    const { versions } = await recent(cookie);
    expect(versions.map((v) => [v.deleted, v.before?.deleted])).toEqual([[false, true], [true, false], [false, undefined]]);
  });
  it('knows a card was in the Trash though its versions are from before that was kept', async () => {
    const { db, signIn, push, edit, recent } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const seq = await edit(cookie, vault, 'a', [[0, 'text']]);
    db.raw.exec(`UPDATE card_versions SET deleted = NULL`);
    await push(cookie, [rec(vault, 'a', { seq, updated_at: MIN, payload: 'text', deleted: true })]);
    expect((await recent(cookie)).versions.map((v) => [v.deleted, v.before?.deleted])).toEqual([[true, false], [false, undefined]]);

    const [first] = await push(cookie, [rec(vault, 'b', { updated_at: 0, payload: 'old', deleted: true })]);
    db.raw.exec(`DELETE FROM card_versions WHERE card_id = 'b'`);
    await push(cookie, [rec(vault, 'b', { seq: seqOf(first), updated_at: 2 * MIN, payload: 'old' })]);
    expect((await recent(cookie)).versions[0]).toMatchObject({ card_id: 'b', deleted: false, before: { payload: 'old', deleted: true } });
  });
  it('keeps each device’s edits as versions of their own', async () => {
    const { signIn, pushFrom, list } = historyApi();
    const { cookie, vault } = await signIn('ann');
    let [r] = await pushFrom(cookie, LAPTOP, [rec(vault, 'a', { updated_at: 0, payload: 'one' })]);
    [r] = await pushFrom(cookie, LAPTOP, [rec(vault, 'a', { seq: seqOf(r), updated_at: MIN, payload: 'two' })]);
    expect((await list(cookie, 'a')).versions).toHaveLength(1);
    await pushFrom(cookie, PHONE, [rec(vault, 'a', { seq: seqOf(r), updated_at: 2 * MIN, payload: 'three' })]);
    expect((await list(cookie, 'a')).versions).toHaveLength(2);
  });
  it('keeps both sides of a conflict', async () => {
    const { signIn, push, list, get } = historyApi();
    const { cookie, vault } = await signIn('ann');
    await push(cookie, [rec(vault, 'a', { updated_at: 100, payload: 'phone' })]);
    await push(cookie, [rec(vault, 'a', { seq: 0, updated_at: 200, payload: 'laptop' })]);
    const { versions } = await list(cookie, 'a');
    expect(versions).toHaveLength(2);
    expect((await get(cookie, 'a', versions[1].id)).version?.payload).toBe('phone');
  });
  it("saves a card's earlier state the first time it changes after history began", async () => {
    const { db, signIn, push, list, get } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const [first] = await push(cookie, [rec(vault, 'a', { updated_at: 100, payload: 'before' })]);
    db.raw.exec('DELETE FROM card_versions');
    await push(cookie, [rec(vault, 'a', { seq: seqOf(first), updated_at: 200, payload: 'after' })]);
    const { versions } = await list(cookie, 'a');
    expect(versions.map((v) => v.author)).toEqual(['ann', null]);
    expect((await get(cookie, 'a', versions[1].id)).version).toMatchObject({ payload: 'before', saved_at: 100 });
  });
  it('drops the oldest versions past the limit', async () => {
    const { db, signIn } = historyApi();
    const { user: ann, vault } = await signIn('ann');
    db.raw.exec(`INSERT INTO cards (id, vault_id, updated_at, deleted, seq, payload) VALUES ('a', '${vault}', 0, 0, 1, 'p0')`);
    for (let i = 1; i <= VERSION_LIMIT + 3; i++) {
      await recordVersions(db, ann.id, [{ record: rec(vault, 'a', { updated_at: i * VERSION_GAP * 2, payload: `p${i}` }), conflict: false }]);
    }
    const rows = db.raw.prepare(`SELECT payload FROM card_versions ORDER BY id`).all();
    expect(rows).toHaveLength(VERSION_LIMIT);
    expect(rows.at(-1)!.payload).toBe(`p${VERSION_LIMIT + 3}`);
  });
  it('only shows history to members of the card’s vault', async () => {
    const { signIn, edit, list, get } = historyApi();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    await edit(ann.cookie, ann.vault, 'a', [[0, 'secret']]);
    const { versions } = await list(ann.cookie, 'a');
    expect((await list(ben.cookie, 'a')).status).toBe(404);
    expect((await get(ben.cookie, 'a', versions[0].id)).status).toBe(404);
    expect((await get(ann.cookie, 'a', 'nope')).status).toBe(404);
    expect((await get(ann.cookie, 'missing', versions[0].id)).status).toBe(404);
    expect((await list(ann.cookie, 'missing')).status).toBe(404);
  });
  it('never folds an AI edit into a person’s version', async () => {
    const { signIn, edit, list, db } = historyApi();
    const { cookie, vault, user } = await signIn('ann');
    const seq = await edit(cookie, vault, 'a', [[0, 'mine']]);
    await pushRecords(db, user.id, [rec(vault, 'a', { seq, updated_at: MIN, payload: 'from claude' })], 'Claude');
    const { versions } = await list(cookie, 'a');
    expect(versions.map((v) => [v.author, v.via])).toEqual([['ann', 'Claude'], ['ann', null]]);
  });
  it('keeps history apart for each editor of a shared vault', async () => {
    const { db, signIn, push, list } = historyApi();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    db.raw.exec(`INSERT INTO vault_members (vault_id, user_id, role) VALUES ('${ann.vault}', '${ben.user.id}', 'editor')`);
    const [first] = await push(ann.cookie, [rec(ann.vault, 'a', { updated_at: 0, payload: 'ann wrote' })]);
    await push(ben.cookie, [rec(ann.vault, 'a', { seq: seqOf(first), updated_at: MIN, payload: 'ben wrote' })]);
    expect((await list(ben.cookie, 'a')).versions.map((v) => v.author)).toEqual(['ben', 'ann']);
  });
});

describe('the history of every card', () => {
  it('lists what changed on any card, newest first, each with what it replaced', async () => {
    const { signIn, edit, recent } = historyApi();
    const { cookie, vault } = await signIn('ann');
    await edit(cookie, vault, 'a', [[0, 'a1'], [VERSION_GAP * 2, 'a2']]);
    await edit(cookie, vault, 'b', [[VERSION_GAP, 'b1']]);
    const { versions, next } = await recent(cookie);
    expect(versions.map((v) => [v.card_id, v.payload, v.before?.payload ?? null, v.saved_at])).toEqual([
      ['a', 'a2', 'a1', VERSION_GAP * 2],
      ['b', 'b1', null, VERSION_GAP],
      ['a', 'a1', null, 0],
    ]);
    expect(versions[0]).toMatchObject({ vault_id: vault, author: 'ann', mine: true, via: null, device: null });
    expect(next).toBeNull();
  });
  it('says which of the account’s devices made a version, and whether it is the one asking', async () => {
    const { signIn, pushFrom, recent } = historyApi();
    const { cookie, vault } = await signIn('ann');
    await pushFrom(cookie, LAPTOP, [rec(vault, 'a', { updated_at: 0 })], 'Chrome on Mac');
    await pushFrom(cookie, PHONE, [rec(vault, 'b', { updated_at: MIN })], '  Safari on iPhone\u0007 ');
    await pushFrom(cookie, 'x', [rec(vault, 'c', { updated_at: 2 * MIN })]);
    const devices = async (asking?: string) => (await recent(cookie, asking)).versions.map((v) => v.device);
    expect(await devices(LAPTOP)).toEqual([null, { here: false, name: 'Safari on iPhone' }, { here: true, name: 'Chrome on Mac' }]);
    expect(await devices()).toEqual([null, { here: false, name: 'Safari on iPhone' }, { here: false, name: 'Chrome on Mac' }]);
  });
  it('names the AI app and the person, and keeps other people’s devices to themselves', async () => {
    const { db, signIn, pushFrom, recent } = historyApi();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    db.raw.exec(`INSERT INTO vault_members (vault_id, user_id, role) VALUES ('${ann.vault}', '${ben.user.id}', 'editor')`);
    const [first] = await pushFrom(ann.cookie, LAPTOP, [rec(ann.vault, 'a', { updated_at: 0, payload: 'ann' })], 'Chrome on Mac');
    const [second] = await pushRecords(db, ann.user.id, [rec(ann.vault, 'a', { seq: seqOf(first), updated_at: MIN, payload: 'claude' })], 'Claude');
    await pushFrom(ben.cookie, PHONE, [rec(ann.vault, 'a', { seq: seqOf(second), updated_at: 2 * MIN, payload: 'ben' })], 'Safari on iPhone');
    const seen = async (cookie: string) => (await recent(cookie, LAPTOP)).versions.map((v) => [v.author, v.mine, v.via, v.device]);
    expect(await seen(ann.cookie)).toEqual([
      ['ben', false, null, null],
      ['ann', true, 'Claude', null],
      ['ann', true, null, { here: true, name: 'Chrome on Mac' }],
    ]);
    expect(await seen(ben.cookie)).toEqual([
      ['ben', true, null, { here: false, name: 'Safari on iPhone' }],
      ['ann', false, 'Claude', null],
      ['ann', false, null, null],
    ]);
  });
  it('only lists cards the account can read', async () => {
    const { signIn, edit, recent } = historyApi();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    await edit(ann.cookie, ann.vault, 'a', [[0, 'secret']]);
    await edit(ben.cookie, ben.vault, 'b', [[MIN, 'mine']]);
    expect((await recent(ben.cookie)).versions.map((v) => v.card_id)).toEqual(['b']);
  });
  it('lists a card shared with the account', async () => {
    const { db, signIn, edit, recent } = historyApi();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    await edit(ann.cookie, ann.vault, 'a', [[0, 'shared']]);
    await edit(ann.cookie, ann.vault, 'b', [[MIN, 'kept']]);
    db.raw.exec(
      `INSERT INTO card_shares (card_id, target_type, target_id, role, shared_by, created_at) VALUES ('a', 'user', '${ben.user.id}', 'view', '${ann.user.id}', 0)`,
    );
    expect((await recent(ben.cookie)).versions.map((v) => [v.card_id, v.author, v.mine])).toEqual([['a', 'ann', false]]);
  });
  it('leaves out a card’s state from before history was kept, but shows what replaced it', async () => {
    const { db, signIn, push, recent } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const [first] = await push(cookie, [rec(vault, 'a', { updated_at: 100, payload: 'before' })]);
    db.raw.exec('DELETE FROM card_versions');
    await push(cookie, [rec(vault, 'a', { seq: seqOf(first), updated_at: 200, payload: 'after' })]);
    const { versions } = await recent(cookie);
    expect(versions.map((v) => [v.payload, v.before?.payload])).toEqual([['after', 'before']]);
  });
  it('leaves out the oldest version of a card that has had older ones dropped', async () => {
    const { db, signIn, recent } = historyApi();
    const { user: ann, cookie, vault } = await signIn('ann');
    db.raw.exec(`INSERT INTO cards (id, vault_id, updated_at, deleted, seq, payload) VALUES ('a', '${vault}', 0, 0, 1, 'p0')`);
    for (let i = 1; i <= VERSION_LIMIT + 3; i++) {
      await recordVersions(db, ann.id, [{ record: rec(vault, 'a', { updated_at: i * VERSION_GAP * 2, payload: `p${i}` }), conflict: false }]);
    }
    const seen: (string | undefined)[][] = [];
    for (let page = await recent(cookie); ; page = await recent(cookie, undefined, page.next)) {
      seen.push(...page.versions.map((v) => [v.payload, v.before?.payload]));
      if (!page.next) break;
    }
    // What the oldest one left changed went with the version before it, so it isn't shown as the card being made.
    expect(seen).toHaveLength(VERSION_LIMIT - 1);
    expect(seen.at(-1)).toEqual(['p5', 'p4']);
  });
  it('comes a page at a time', async () => {
    const { signIn, push, recent, call } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const total = RECENT_LIMIT + 5;
    for (let i = 0; i < total; i += 20) {
      await push(cookie, Array.from({ length: Math.min(20, total - i) }, (_, j) => rec(vault, `c${i + j}`, { updated_at: i + j })));
    }
    const first = await recent(cookie);
    expect(first.versions).toHaveLength(RECENT_LIMIT);
    expect(first.versions[0].card_id).toBe(`c${total - 1}`);
    const second = await recent(cookie, undefined, first.next!);
    expect(second.versions.map((v) => v.card_id)).toEqual(['c4', 'c3', 'c2', 'c1', 'c0']);
    expect(second.next).toBeNull();
    expect((await call('/api/versions?before=nope', {}, cookie)).status).toBe(400);
  });
  it('keeps a page of long entries short', async () => {
    const { signIn, push, recent } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const long = 'x'.repeat(600_000);
    await push(cookie, [0, 1, 2, 3].map((i) => rec(vault, `c${i}`, { updated_at: i, payload: long + i })));
    const first = await recent(cookie);
    expect(first.versions.map((v) => v.card_id)).toEqual(['c3', 'c2']);
    expect((await recent(cookie, undefined, first.next!)).versions.map((v) => v.card_id)).toEqual(['c1', 'c0']);
  });
});
