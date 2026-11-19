import { describe, expect, it } from 'vitest';
import { removeExpired } from './cleanup';
import type { ServerDraft } from '../src/sync/protocol';
import { DRAFT_DAYS, MAX_DRAFT_BYTES } from './drafts';
import { DAY, setup } from './testHarness';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function withAccounts() {
  const t = setup();
  const ann = await t.signIn('ann');
  const ben = await t.signIn('ben');
  const put = (cookie: string, drafts: unknown) => t.call('/api/drafts', { method: 'PUT', body: JSON.stringify({ drafts }) }, cookie);
  const get = async (cookie: string, since?: number) =>
    (await (await t.call(`/api/drafts${since === undefined ? '' : `?since=${since}`}`, {}, cookie)).json()) as { drafts: ServerDraft[]; at: number };
  return { ...t, ann, ben, put, get };
}

describe('drafts that follow an account between devices', () => {
  it('keeps each draft for its own account, and gives back those changed since', async () => {
    const { ann, ben, put, get, advance } = await withAccounts();
    expect((await put(ann.cookie, [{ kind: 'journal', key: '/journal', value: doc('Buy milk') }, { kind: 'comment', key: 'card-1', value: 'Looks good' }])).status).toBe(200);
    const first = await get(ann.cookie);
    expect(first.drafts.map((d) => [d.kind, d.key, d.value])).toEqual([
      ['journal', '/journal', doc('Buy milk')],
      ['comment', 'card-1', 'Looks good'],
    ]);
    expect((await get(ben.cookie)).drafts).toEqual([]);

    advance(1000);
    await put(ann.cookie, [{ kind: 'comment', key: 'card-1', value: 'Looks good, but' }]);
    const next = await get(ann.cookie, first.at);
    expect(next.drafts.map((d) => d.value)).toEqual(['Looks good, but']);
    expect(next.at).toBeGreaterThan(first.at);
    expect((await get(ann.cookie, next.at)).drafts).toEqual([]);
  });

  it('keeps one sent or emptied as gone, for devices that had it, but not for one asking afresh', async () => {
    const { ann, put, get, advance } = await withAccounts();
    await put(ann.cookie, [{ kind: 'journal', key: '/journal', value: doc('Buy milk') }]);
    const before = await get(ann.cookie);
    advance(1000);
    await put(ann.cookie, [{ kind: 'journal', key: '/journal', value: null }]);
    expect((await get(ann.cookie, before.at)).drafts.map((d) => [d.key, d.value])).toEqual([['/journal', null]]);
    expect((await get(ann.cookie)).drafts).toEqual([]);
  });

  it('orders changes by when they arrive, even two in the same moment', async () => {
    const { ann, put, get } = await withAccounts();
    await put(ann.cookie, [{ kind: 'comment', key: 'c', value: 'one' }]);
    const seen = await get(ann.cookie);
    await put(ann.cookie, [{ kind: 'comment', key: 'c', value: 'two' }]);
    const later = await get(ann.cookie, seen.at);
    expect(later.drafts.map((d) => d.value)).toEqual(['two']);
  });

  it('turns down what it can’t keep', async () => {
    const { ann, put } = await withAccounts();
    expect((await put(ann.cookie, [])).status).toBe(400);
    expect((await put(ann.cookie, [{ kind: 'email', key: 'x', value: 'hi' }])).status).toBe(400);
    expect((await put(ann.cookie, [{ kind: 'comment', key: '', value: 'hi' }])).status).toBe(400);
    expect((await put(ann.cookie, [{ kind: 'comment', key: 'c' }])).status).toBe(400);
    expect((await put(ann.cookie, [{ kind: 'comment', key: 'c', value: 'x'.repeat(MAX_DRAFT_BYTES) }])).status).toBe(413);
  });

  it('needs a session', async () => {
    const { call } = await withAccounts();
    expect((await call('/api/drafts')).status).toBe(401);
  });

  it('forgets those left 30 days, at the daily cleanup', async () => {
    const { ann, put, get, db } = await withAccounts();
    await put(ann.cookie, [{ kind: 'comment', key: 'c', value: 'old' }]);
    await removeExpired(db, 1_000_000 + (DRAFT_DAYS - 1) * DAY);
    expect((await get(ann.cookie)).drafts).toHaveLength(1);
    await removeExpired(db, 1_000_000 + (DRAFT_DAYS + 1) * DAY);
    expect((await get(ann.cookie)).drafts).toHaveLength(0);
  });
});
