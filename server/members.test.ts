import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import { notePayload as note, people, rec } from './testHarness';

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
    expect((await me(ben.cookie)).vaults.map((v) => v.id)).toEqual([ben.vault]);
    expect(await ids(ben.cookie)).toEqual([]);
  });
  it('invites someone without an account, who joins at first sign-in', async () => {
    const { ann, send, signIn, me, json } = await people();
    const invited = await json<{ invites: { email: string }[] }>(send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'cat@example.com', role: 'viewer' }));
    expect(invited.invites).toEqual([{ email: 'cat@example.com', role: 'viewer' }]);
    const cat = await signIn('cat');
    expect((await me(cat.cookie)).vaults.map((v) => v.id)).toContain(ann.vault);
  });
  it('keeps private vaults unshared, and shared vaults without a PIN', async () => {
    const { ann, send, json } = await people();
    const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };
    const secret = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Secret', pin }));
    expect((await send(ann.cookie, 'POST', `/api/vaults/${secret.id}/members`, { email: 'ben@example.com', role: 'viewer' })).status).toBe(400);
    const family = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Family' }));
    await send(ann.cookie, 'POST', `/api/vaults/${family.id}/members`, { email: 'ben@example.com', role: 'viewer' });
    expect((await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin })).status).toBe(400);
  });
  it('lets only the owner add people', async () => {
    const { ann, ben, send } = await people();
    await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'ben@example.com', role: 'editor' });
    expect((await send(ben.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'cat@example.com', role: 'editor' })).status).toBe(404);
    expect((await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'nope', role: 'editor' })).status).toBe(400);
  });
});
