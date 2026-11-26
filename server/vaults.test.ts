import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import { setup } from './testHarness';

const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };

function vaultApi() {
  const t = setup();
  const send = async (cookie: string, method: string, path: string, body: unknown) => {
    const res = await t.call(path, { method, body: JSON.stringify(body) }, cookie);
    return { status: res.status, vault: (await res.json()) as Vault };
  };
  return { ...t, create: (cookie: string, body: unknown) => send(cookie, 'POST', '/api/vaults', body), patch: (cookie: string, id: string, body: unknown) => send(cookie, 'PATCH', `/api/vaults/${id}`, body) };
}

describe('vaults', () => {
  it('starts with an open default vault', async () => {
    const { signIn } = vaultApi();
    const { vaults } = await signIn('ann');
    expect(vaults[0]).toMatchObject({ lock: 'none', pin: null, hidden: false });
  });
  it('creates a private vault, with its owner as a member', async () => {
    const { signIn, create, call, advance } = vaultApi();
    const { cookie } = await signIn('ann');
    advance(1000);
    const { status, vault } = await create(cookie, { name: ' Secrets ', pin, hidden: true });
    expect(status).toBe(201);
    expect(vault).toMatchObject({ name: 'Secrets', lock: 'pin', pin, hidden: true, ai_access: 'off' });
    const me = (await (await call('/api/me', {}, cookie)).json()) as { vaults: Vault[] };
    expect(me.vaults.map((v) => v.name)).toEqual(['Personal', 'Diary', 'Secrets']);
  });
  it('accepts writes to a new vault', async () => {
    const { signIn, create, push } = vaultApi();
    const { cookie } = await signIn('ann');
    const { vault } = await create(cookie, { name: 'Work' });
    const [result] = await push(cookie, [{ id: 'a', vault_id: vault.id, updated_at: 1, deleted: false, seq: 0, payload: 'x' }]);
    expect(result.status).toBe('ok');
  });
  it('rejects invalid input', async () => {
    const { signIn, create, patch } = vaultApi();
    const { cookie, vault } = await signIn('ann');
    expect((await create(cookie, {})).status).toBe(400);
    expect((await create(cookie, { name: '   ' })).status).toBe(400);
    expect((await create(cookie, { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await create(cookie, { name: 'A', pin: { salt: 'x' } })).status).toBe(400);
    expect((await create(cookie, { name: 'A', pin: { ...pin, iterations: 5 } })).status).toBe(400);
    expect((await patch(cookie, vault, { hidden: 'yes' })).status).toBe(400);
  });
  it('cannot be hidden without a PIN', async () => {
    const { signIn, create, patch } = vaultApi();
    const { cookie } = await signIn('ann');
    const { vault } = await create(cookie, { name: 'A', hidden: true });
    expect(vault.hidden).toBe(false);
    expect((await patch(cookie, vault.id, { hidden: true })).vault.hidden).toBe(false);
  });
  it('sets, changes and removes a PIN', async () => {
    const { signIn, create, patch } = vaultApi();
    const { cookie } = await signIn('ann');
    const { vault } = await create(cookie, { name: 'A' });
    expect((await patch(cookie, vault.id, { pin, hidden: true })).vault).toMatchObject({ lock: 'pin', pin, hidden: true });
    expect((await patch(cookie, vault.id, { name: 'B' })).vault).toMatchObject({ name: 'B', lock: 'pin', pin, hidden: true });
    expect((await patch(cookie, vault.id, { pin: null })).vault).toMatchObject({ lock: 'none', pin: null, hidden: false });
  });
  it('turns off AI access when a vault becomes private', async () => {
    const { db, signIn, create, patch } = vaultApi();
    const { cookie } = await signIn('ann');
    const { vault } = await create(cookie, { name: 'A' });
    db.raw.prepare(`UPDATE vaults SET ai_access = 'write' WHERE id = ?`).run(vault.id);
    expect((await patch(cookie, vault.id, { pin })).vault.ai_access).toBe('off');
  });
  it('sets AI access on an open vault only', async () => {
    const { signIn, create, patch } = vaultApi();
    const { cookie, vault: personal } = await signIn('ann');
    expect((await patch(cookie, personal, { ai_access: 'read' })).vault).toMatchObject({ ai_access: 'read', ai_access_override: 'read' });
    expect((await patch(cookie, personal, { ai_access: 'everything' })).status).toBe(400);
    const { vault: diary } = await create(cookie, { name: 'Diary', pin });
    expect((await patch(cookie, diary.id, { ai_access: 'write' })).status).toBe(400);
    expect((await patch(cookie, diary.id, { pin: null, ai_access: 'write' })).vault).toMatchObject({ ai_access: 'write', ai_access_override: 'write' });
    expect((await patch(cookie, diary.id, { ai_access: 'off' })).vault).toMatchObject({ ai_access: 'off', ai_access_override: 'off' });
    expect((await patch(cookie, diary.id, { ai_access: 'default' })).vault).toMatchObject({ ai_access: 'off', ai_access_override: null });
  });
  it('applies the account default AI access to open vaults unless overridden', async () => {
    const { signIn, create, patch, call } = vaultApi();
    const { cookie, vault: personal } = await signIn('ann');
    const { vault: locked } = await create(cookie, { name: 'Secret', pin });
    await patch(cookie, personal, { ai_access: 'off' });

    const res = await call('/api/ai/settings', { method: 'PATCH', body: JSON.stringify({ default_access: 'write' }) }, cookie);
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { default_access: string; vaults: Vault[] };
    expect(updated.default_access).toBe('write');
    expect(updated.vaults.find((v) => v.id === personal)).toMatchObject({ ai_access: 'off', ai_access_override: 'off' });
    expect(updated.vaults.find((v) => v.name === 'Diary')).toMatchObject({ ai_access: 'write', ai_access_override: null });
    expect(updated.vaults.find((v) => v.id === locked.id)).toMatchObject({ ai_access: 'off', ai_access_override: null });

    // A new open vault inherits the default; a new private one stays off.
    const { vault: work } = await create(cookie, { name: 'Work' });
    expect(work).toMatchObject({ ai_access: 'write', ai_access_override: null });
    const { vault: secret2 } = await create(cookie, { name: 'Secret 2', pin });
    expect(secret2).toMatchObject({ ai_access: 'off', ai_access_override: null });

    // Resetting an override falls back to the current account default.
    expect((await patch(cookie, personal, { ai_access: 'default' })).vault).toMatchObject({ ai_access: 'write', ai_access_override: null });
    expect((await call('/api/ai/settings', { method: 'PATCH', body: JSON.stringify({ default_access: 'bad' }) }, cookie)).status).toBe(400);
  });
  it('refuses to lock the default vault, but allows renaming it', async () => {
    const { signIn, patch } = vaultApi();
    const { cookie, vault } = await signIn('ann');
    expect((await patch(cookie, vault, { pin })).status).toBe(400);
    expect((await patch(cookie, vault, { name: 'Everyday' })).vault.name).toBe('Everyday');
  });
  it('lets only the owner change a vault', async () => {
    const { db, signIn, create, patch, call } = vaultApi();
    const ann = await signIn('ann');
    const bob = await signIn('bob');
    const { vault } = await create(ann.cookie, { name: 'A' });
    expect((await patch(bob.cookie, vault.id, { name: 'stolen' })).status).toBe(404);
    db.raw.prepare(`INSERT INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'editor')`).run(vault.id, bob.user.id);
    // A member changes only their own lock.
    expect((await patch(bob.cookie, vault.id, { name: 'stolen' })).status).toBe(400);
    expect((await patch(bob.cookie, vault.id, { pin, ai_access: 'off' })).status).toBe(400);
    expect((await patch(bob.cookie, vault.id, { pin, hidden: true })).vault).toMatchObject({ name: 'A', lock: 'pin', pin, hidden: true });
    const of = async (cookie: string) => ((await (await call('/api/me', {}, cookie)).json()) as { vaults: Vault[] }).vaults.find((v) => v.id === vault.id);
    expect(await of(ann.cookie)).toMatchObject({ name: 'A', lock: 'none', pin: null, hidden: false });
    expect((await patch(bob.cookie, vault.id, { pin: null })).vault).toMatchObject({ lock: 'none', pin: null, hidden: false });
  });
  it('requires a session', async () => {
    const { call } = vaultApi();
    expect((await call('/api/vaults', { method: 'POST', body: '{"name":"A"}' })).status).toBe(401);
  });
});
