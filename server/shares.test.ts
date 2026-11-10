import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import type { PushResult } from '../src/sync/protocol';
import type { CardShares } from './shares';
import { DAY, notePayload as note, people, rec } from './testHarness';

const seqOf = (r: PushResult) => (r as { seq: number }).seq;

describe('sharing one card', () => {
  it('shares with a person, who syncs only that card and edits it only if allowed', async () => {
    const { ann, ben, push, send, ids, json } = await people();
    const [first] = await push(ann.cookie, [rec(ann.vault, 'a1', { payload: note('Recipe') }), rec(ann.vault, 'a2', { payload: note('Private') })]);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'view' });
    expect(await ids(ben.cookie)).toEqual(['a1']);
    expect(await json(send(ben.cookie, 'GET', '/api/shared'))).toEqual({ cards: [{ card_id: 'a1', role: 'view', shared_by: 'ann' }] });
    const edit = rec(ann.vault, 'a1', { seq: seqOf(first), updated_at: 200, payload: note('Recipe v2') });
    expect((await push(ben.cookie, [edit]))[0].status).toBe('forbidden');

    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'edit' });
    expect((await push(ben.cookie, [edit]))[0].status).toBe('ok');
    const [trash] = await push(ben.cookie, [{ ...edit, seq: seqOf(first) + 10, deleted: true, updated_at: 300 }]);
    expect(trash.status).toBe('forbidden');
    expect((await push(ben.cookie, [rec(ben.vault, 'a1', { updated_at: 400 })]))[0].status).toBe('forbidden');

    await send(ann.cookie, 'DELETE', `/api/cards/a1/shares/user/${ben.user.id}`);
    expect(await json(send(ben.cookie, 'GET', '/api/shared'))).toEqual({ cards: [] });
    expect(await ids(ben.cookie)).toEqual([]);
  });
  it('shares with everyone in another vault', async () => {
    const { ann, ben, push, send, ids, json } = await people();
    const family = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Family' }));
    await send(ann.cookie, 'POST', `/api/vaults/${family.id}/members`, { email: 'ben@example.com', role: 'viewer' });
    await push(ann.cookie, [rec(ann.vault, 'a1', { payload: note('Trip') })]);
    const shares = await json<CardShares>(send(ann.cookie, 'POST', '/api/cards/a1/shares', { vault_id: family.id, role: 'comment' }));
    expect(shares.vaults).toEqual([{ vault_id: family.id, name: 'Family', role: 'comment', members: 2 }]);
    expect(await ids(ben.cookie)).toEqual(['a1']);
    expect((await send(ann.cookie, 'POST', '/api/cards/a1/shares', { vault_id: ben.vault, role: 'view' })).status).toBe(404);
  });
  it('lets only members who can edit share a card', async () => {
    const { ann, ben, push, send } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1')]);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'edit' });
    expect((await send(ben.cookie, 'POST', '/api/cards/a1/shares', { email: 'cat@example.com', role: 'view' })).status).toBe(404);
    expect((await send(ben.cookie, 'GET', '/api/cards/a1/shares')).status).toBe(404);
  });
  it('holds a share for an email until that person signs up', async () => {
    const { ann, push, send, signIn, ids } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1')]);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'cat@example.com', role: 'view' });
    const cat = await signIn('cat');
    expect(await ids(cat.cookie)).toEqual(['a1']);
  });
  it('shows history to people a card is shared with', async () => {
    const { ann, ben, push, send } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1')]);
    expect((await send(ben.cookie, 'GET', '/api/cards/a1/versions')).status).toBe(404);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'view' });
    expect((await send(ben.cookie, 'GET', '/api/cards/a1/versions')).status).toBe(200);
  });
});

describe('public links', () => {
  it('shows a card to anyone with the link until it expires or is turned off', async () => {
    const { ann, ben, push, send, call, json, advance } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1', { payload: note('Open letter') })]);
    expect((await send(ben.cookie, 'POST', '/api/cards/a1/links', {})).status).toBe(404);
    const shares = await json<CardShares>(send(ann.cookie, 'POST', '/api/cards/a1/links', { expires_in_days: 7 }));
    const { token } = shares.links[0];
    expect(await json(call(`/api/public/${token}`))).toMatchObject({ type: 'note', title: 'Open letter' });
    advance(8 * DAY);
    expect((await call(`/api/public/${token}`)).status).toBe(404);

    const again = await json<CardShares>(send(ann.cookie, 'POST', '/api/cards/a1/links', {}));
    const forever = again.links[0].token;
    expect((await call(`/api/public/${forever}`)).status).toBe(200);
    expect((await call(`/api/public/${forever}/photos/not-in-card`)).status).toBe(404);
    await send(ann.cookie, 'DELETE', `/api/cards/a1/links/${forever}`);
    expect((await call(`/api/public/${forever}`)).status).toBe(404);
    expect((await call('/api/public/made-up')).status).toBe(404);
  });
});
