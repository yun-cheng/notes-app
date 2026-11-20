import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import { notePayload as note, people, rec } from './testHarness';

const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };
const encryption = { version: 1, kdf: { name: 'argon2id', salt: 'c2FsdA==', memory: 19456, iterations: 2, parallelism: 1 }, wrapped: 'd3JhcHBlZA==', recovery: 'cmVjb3Zlcnk=' };

describe('sharing a vault', () => {
  it('adds a member with a role, who then syncs its cards', async () => {
    const { ann, ben, push, send, me, ids, json } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1', { payload: note('Shared') })]);
    const added = await json<{ members: { email: string; role: string }[] }>(send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'BEN@example.com', role: 'viewer' }));
    expect(added.members.map((m) => [m.email, m.role])).toEqual([['ann@example.com', 'owner'], ['ben@example.com', 'viewer']]);
    const vault = (await me(ben.cookie)).vaults.find((v) => v.id === ann.vault) as Vault;
    expect(vault).toMatchObject({ role: 'viewer', members: 2, name: 'Personal' });
    expect(await ids(ben.cookie)).toEqual(['a1']);
    expect((await push(ben.cookie, [rec(ann.vault, 'b1')]))[0].status).toBe('forbidden');
    await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'ben@example.com', role: 'editor' });
    expect((await push(ben.cookie, [rec(ann.vault, 'b1')]))[0].status).toBe('ok');
  });
  it('lets a member leave and the owner remove people, but not the owner', async () => {
    const { ann, ben, send, me, ids } = await people();
    await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'ben@example.com', role: 'editor' });
    expect((await send(ben.cookie, 'DELETE', `/api/vaults/${ann.vault}/members/${ann.user.id}`)).status).toBe(404);
    expect((await send(ben.cookie, 'DELETE', `/api/vaults/${ann.vault}/members/${ben.user.id}`)).status).toBe(200);
    expect((await me(ben.cookie)).vaults.map((v) => v.id)).not.toContain(ann.vault);
    expect(await ids(ben.cookie)).toEqual([]);
  });
  it('invites someone without an account, who joins at first sign-in', async () => {
    const { ann, send, signIn, me, json } = await people();
    const invited = await json<{ invites: { email: string }[] }>(send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'cat@example.com', role: 'viewer' }));
    expect(invited.invites).toEqual([{ email: 'cat@example.com', role: 'viewer' }]);
    const cat = await signIn('cat');
    expect((await me(cat.cookie)).vaults.map((v) => v.id)).toContain(ann.vault);
  });
  it('shares a vault locked by a PIN, but not an encrypted one', async () => {
    const { ann, ben, send, json, me } = await people();
    const secret = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Secret', pin }));
    expect((await send(ann.cookie, 'POST', `/api/vaults/${secret.id}/members`, { email: 'ben@example.com', role: 'viewer' })).status).toBe(200);
    // Ann's PIN is hers: Ben sees the vault open until he locks it himself.
    expect((await me(ben.cookie)).vaults.find((v) => v.id === secret.id)).toMatchObject({ lock: 'none', pin: null, withheld: false });
    const sealed = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Sealed', pin, encryption }));
    expect((await send(ann.cookie, 'POST', `/api/vaults/${sealed.id}/members`, { email: 'ben@example.com', role: 'viewer' })).status).toBe(400);
    // A shared vault takes a PIN, but not encryption.
    const family = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Family' }));
    await send(ann.cookie, 'POST', `/api/vaults/${family.id}/members`, { email: 'ben@example.com', role: 'viewer' });
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin })).status).toBe(200);
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin, encryption })).status).toBe(400);
  });
  it('keeps a vault with an invite still waiting unencrypted', async () => {
    const { ann, send, signIn, me, json } = await people();
    const family = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Family' }));
    await send(ann.cookie, 'POST', `/api/vaults/${family.id}/members`, { email: 'cat@example.com', role: 'viewer' });
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin, encryption })).status).toBe(400);
    // Taking the invite back makes it the owner's alone again.
    await send(ann.cookie, 'DELETE', `/api/vaults/${family.id}/invites/cat@example.com`);
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin, encryption })).status).toBe(200);
    const cat = await signIn('cat');
    expect((await me(cat.cookie)).vaults.map((v) => v.id)).not.toContain(family.id);
  });
  it('sends nothing in a vault to a member without the PIN its owner asks for', async () => {
    const { ann, ben, send, json, me, ids, push } = await people();
    const health = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Health', pin }));
    await push(ann.cookie, [rec(health.id, 'h1', { payload: note('Physio') })]);
    await send(ann.cookie, 'POST', `/api/vaults/${health.id}/members`, { email: 'ben@example.com', role: 'editor' });
    expect(await ids(ben.cookie)).toEqual(['h1']);

    const asked = await json<Vault>(send(ann.cookie, 'PATCH', `/api/vaults/${health.id}`, { members_need_pin: true }));
    expect(asked).toMatchObject({ members_need_pin: true, withheld: false });
    const bens = async () => (await me(ben.cookie)).vaults.find((v) => v.id === health.id);
    expect(await bens()).toMatchObject({ members_need_pin: true, withheld: true });
    expect(await ids(ben.cookie)).toEqual([]);
    expect((await push(ben.cookie, [rec(health.id, 'b1')]))[0].status).toBe('forbidden');
    expect((await send(ben.cookie, 'GET', '/api/cards/h1/versions')).status).toBe(404);
    // Only the owner asks.
    expect((await send(ben.cookie, 'PATCH', `/api/vaults/${health.id}`, { members_need_pin: false })).status).toBe(400);

    expect((await send(ben.cookie, 'PATCH', `/api/vaults/${health.id}`, { pin })).status).toBe(200);
    expect(await bens()).toMatchObject({ lock: 'pin', withheld: false });
    const listed = await json<{ members: { email: string; locked: boolean }[] }>(send(ann.cookie, 'GET', `/api/vaults/${health.id}/members`));
    expect(listed.members.map((m) => [m.email, m.locked])).toEqual([['ann@example.com', true], ['ben@example.com', true]]);
    expect(await ids(ben.cookie)).toEqual(['h1']);
    expect((await push(ben.cookie, [rec(health.id, 'b1')]))[0].status).toBe('ok');

    // It goes with the owner's own PIN.
    const open = await json<Vault>(send(ann.cookie, 'PATCH', `/api/vaults/${health.id}`, { pin: null }));
    expect(open.members_need_pin).toBe(false);
    expect((await json<Vault>(send(ann.cookie, 'PATCH', `/api/vaults/${health.id}`, { members_need_pin: true }))).members_need_pin).toBe(false);
  });
  it('lets only the owner add people', async () => {
    const { ann, ben, send } = await people();
    await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'ben@example.com', role: 'editor' });
    expect((await send(ben.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'cat@example.com', role: 'editor' })).status).toBe(404);
    expect((await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'nope', role: 'editor' })).status).toBe(400);
  });
});
