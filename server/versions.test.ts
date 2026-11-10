import { describe, expect, it } from 'vitest';
import type { PushResult, VersionResponse, VersionsResponse } from '../src/sync/protocol';
import { rec, setup } from './testHarness';
import { recordVersions, VERSION_GAP, VERSION_LIMIT, VERSION_SPAN } from './versions';

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
  return { ...t, list, get, edit };
}

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
  it('skips writes that leave the payload unchanged', async () => {
    const { signIn, push, edit, list } = historyApi();
    const { cookie, vault } = await signIn('ann');
    const seq = await edit(cookie, vault, 'a', [[0, 'same']]);
    await push(cookie, [rec(vault, 'a', { seq, updated_at: VERSION_GAP * 3, payload: 'same', deleted: true })]);
    expect((await list(cookie, 'a')).versions).toHaveLength(1);
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
