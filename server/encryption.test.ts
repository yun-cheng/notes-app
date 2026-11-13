import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import type { PushResult, VersionsResponse } from '../src/sync/protocol';
import { people, rec } from './testHarness';

const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };
const encryption = { version: 1, kdf: { name: 'argon2id', salt: 'c2FsdA==', memory: 19456, iterations: 2, parallelism: 1 }, wrapped: 'd3JhcHBlZA==', recovery: 'cmVjb3Zlcnk=' };
const seqOf = (r: PushResult) => (r as { seq: number }).seq;

async function encryptedVault() {
  const t = await people();
  const vault = await t.json<Vault>(t.send(t.ann.cookie, 'POST', '/api/vaults', { name: 'Diary', pin, encryption }));
  return { ...t, vault };
}

describe('encrypted vaults', () => {
  it('keeps the wrapped key with the vault, untouched', async () => {
    const { vault, me, ann } = await encryptedVault();
    expect(vault.encryption).toEqual(encryption);
    expect((await me(ann.cookie)).vaults.find((v) => v.id === vault.id)?.encryption).toEqual(encryption);
  });
  it('only takes ciphertext', async () => {
    const { vault, push, ann } = await encryptedVault();
    const [plain, sealed] = await push(ann.cookie, [rec(vault.id, 'p', { payload: '{"title":"leak"}' }), rec(vault.id, 's', { payload: 'e1:abc' })]);
    expect([plain.status, sealed.status]).toEqual(['forbidden', 'ok']);
  });
  it('drops encryption only together with the PIN', async () => {
    const { vault, send, json, ann } = await encryptedVault();
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${vault.id}`, { pin: null })).status).toBe(400);
    const open = await json<Vault>(send(ann.cookie, 'PATCH', `/api/vaults/${vault.id}`, { pin: null, encryption: null }));
    expect(open).toMatchObject({ lock: 'none', encryption: null });
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${vault.id}`, { encryption: { nope: 1 } })).status).toBe(400);
  });
  it('purges plaintext history once a vault is encrypted', async () => {
    const t = await people();
    const vault = await t.json<Vault>(t.send(t.ann.cookie, 'POST', '/api/vaults', { name: 'Diary', pin }));
    const [first] = await t.push(t.ann.cookie, [rec(vault.id, 'd', { payload: '{"title":"old"}' })]);
    await t.send(t.ann.cookie, 'PATCH', `/api/vaults/${vault.id}`, { encryption });
    await t.push(t.ann.cookie, [rec(vault.id, 'd', { seq: seqOf(first), updated_at: 999_999_999, payload: 'e1:new' })]);
    expect((await t.send(t.ann.cookie, 'POST', `/api/vaults/${vault.id}/purge-plaintext`)).status).toBe(200);
    const history = await t.json<VersionsResponse>(t.send(t.ann.cookie, 'GET', '/api/cards/d/versions'));
    expect(history.versions).toHaveLength(1);
    expect((await t.send(t.ben.cookie, 'POST', `/api/vaults/${vault.id}/purge-plaintext`)).status).toBe(404);
  });
  it('ends a card\'s sharing when its vault is encrypted, or it moves into one', async () => {
    const t = await people();
    const { send, call, push, ann, ben } = t;
    const open = (await t.me(ann.cookie)).vaults[0].id;
    const vault = await t.json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Diary', pin }));
    const payload = JSON.stringify({ type: 'note', title: 'Plain', content: { type: 'doc' }, tags: [], createdAt: 1 });
    const [, moving] = await push(ann.cookie, [rec(vault.id, 'd', { payload }), rec(open, 'm', { payload })]);
    const tokens: string[] = [];
    for (const id of ['d', 'm']) {
      tokens.push((await t.json<{ links: { token: string }[] }>(send(ann.cookie, 'POST', `/api/cards/${id}/links`, {}))).links[0].token);
      await send(ann.cookie, 'POST', `/api/cards/${id}/shares`, { email: 'ben@example.com', role: 'view' });
      await send(ann.cookie, 'POST', `/api/cards/${id}/shares`, { email: 'cat@example.com', role: 'view' });
    }
    const shared = async () => (await t.json<{ cards: { card_id: string }[] }>(send(ben.cookie, 'GET', '/api/shared'))).cards.map((c) => c.card_id).sort();
    expect(await shared()).toEqual(['d', 'm']);

    await send(ann.cookie, 'PATCH', `/api/vaults/${vault.id}`, { encryption });
    expect(await shared()).toEqual(['m']);
    expect((await call(`/api/public/${tokens[0]}`)).status).toBe(404);
    expect((await call(`/api/public/${tokens[1]}`)).status).toBe(200);

    await push(ann.cookie, [rec(vault.id, 'm', { seq: seqOf(moving), updated_at: 999_999_999, payload: 'e1:moved' })]);
    expect(await shared()).toEqual([]);
    expect((await call(`/api/public/${tokens[1]}`)).status).toBe(404);
    // Cat, invited by email, finds nothing shared at her first sign-in.
    const cat = await t.signIn('cat');
    expect((await t.json<{ cards: unknown[] }>(send(cat.cookie, 'GET', '/api/shared'))).cards).toEqual([]);
  });
  it('answers a public link to an encrypted card as turned off', async () => {
    const { vault, push, call, ann, db } = await encryptedVault();
    await push(ann.cookie, [rec(vault.id, 's', { payload: 'e1:abc' })]);
    await db.prepare(`INSERT INTO public_links (token, card_id, created_by, created_at) VALUES ('tok', 's', ?, 1)`).bind(ann.user.id).run();
    expect((await call('/api/public/tok')).status).toBe(404);
  });
  it('keeps encrypted cards out of sharing for now', async () => {
    const { vault, push, send, ann } = await encryptedVault();
    await push(ann.cookie, [rec(vault.id, 's', { payload: 'e1:abc' })]);
    expect((await send(ann.cookie, 'POST', '/api/cards/s/links', {})).status).toBe(404);
    expect((await send(ann.cookie, 'POST', '/api/cards/s/shares', { email: 'ben@example.com', role: 'view' })).status).toBe(404);
  });
});
