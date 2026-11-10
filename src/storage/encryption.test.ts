import { describe, expect, it } from 'vitest';
import { Keyring } from '../crypto/keyring';
import { createVaultKey } from '../crypto/vaultKeys';
import { buildIndex } from '../domain/cardIndex';
import type { Vault } from '../domain/types';
import type { Journal, JournalOp } from './journal';
import { MemoryStore } from './memoryStore';
import { CardRepository } from './repository';

const vault = (id: string, encrypted: boolean): Vault => ({
  id,
  name: id,
  owner_id: 'me',
  lock: encrypted ? 'pin' : 'none',
  ai_access: 'off',
  created_at: id === 'vault-me' ? 1 : 2,
  pin: null,
  hidden: false,
  encryption: encrypted ? ({ version: 1 } as Vault['encryption']) : null,
});

async function setup() {
  const store = new MemoryStore();
  const keyring = new Keyring();
  const vaults = [vault('vault-me', false), vault('secret', true)];
  await store.putVaults(vaults);
  keyring.setVaults(vaults);
  const saved: JournalOp[][] = [];
  const journal: Journal = { load: () => [], save: (ops) => saved.push(ops.map((op) => ({ ...op }))) };
  let n = 0;
  const repo = new CardRepository(store, keyring, undefined, () => `id${++n}`, journal, 'vault-me');
  await repo.init();
  const { key } = await createVaultKey('2468', { memory: 256, iterations: 1 });
  keyring.set('secret', key);
  const decodeAll = async () => Promise.all((await store.listCards()).map((r) => repo.decode(r)));
  return { store, keyring, repo, key, saved, decodeAll };
}

describe('cards in an encrypted vault', () => {
  it('are stored as ciphertext and read back with the key', async () => {
    const { store, repo } = await setup();
    const card = await repo.createNote({ title: 'Hidden title', vaultId: 'secret' });
    const open = await repo.createNote({ title: 'Plain title' });
    const records = new Map((await store.listCards()).map((r) => [r.id, r]));
    expect(records.get(card.id)!.payload).toMatch(/^e1:/);
    expect(records.get(card.id)!.payload).not.toContain('Hidden title');
    expect(records.get(open.id)!.payload).toContain('Plain title');
    expect((await repo.decode(records.get(card.id)!)).title).toBe('Hidden title');
  });
  it('become sealed stand-ins once the key is forgotten, which locked vaults hide and nothing can save', async () => {
    const { repo, keyring, decodeAll } = await setup();
    const card = await repo.createNote({ title: 'Hidden title', vaultId: 'secret' });
    await repo.saveDiary('2026-11-10', { content: { type: 'doc', content: [] } }, undefined, 'secret');
    keyring.forget('secret');
    const cards = await decodeAll();
    expect(cards.find((c) => c.id === card.id)!.title).toBe('');
    const index = buildIndex(cards, new Set(['secret']));
    expect(index.lockedCards.has(card.id)).toBe(true);
    expect(index.lockedDiaries.get('2026-11-10')).toBe('secret');
    await expect(repo.update(card.id, { title: 'overwrite' })).rejects.toThrow();
  });
  it('keep their edits out of the plaintext journal', async () => {
    const { repo, saved } = await setup();
    const secret = await repo.createNote({ title: 'x', vaultId: 'secret' });
    const open = await repo.createNote({ title: 'y' });
    saved.length = 0;
    await repo.update(secret.id, { title: 'Very secret' });
    await repo.saveDiary('2026-11-10', { content: { type: 'doc', content: [] } }, undefined, 'secret');
    expect(JSON.stringify(saved)).not.toContain('Very secret');
    expect(saved.flat()).toHaveLength(0);
    await repo.update(open.id, { title: 'fine' });
    expect(JSON.stringify(saved)).toContain('fine');
  });
  it('are re-stored when a vault is encrypted later', async () => {
    const { store, repo, keyring } = await setup();
    const plain = vault('later', false);
    keyring.setVaults([vault('vault-me', false), vault('secret', true), plain]);
    const card = await repo.createNote({ title: 'Was plain', vaultId: 'later' });
    expect((await store.getCard(card.id))!.payload).toContain('Was plain');
    keyring.setVaults([vault('vault-me', false), vault('secret', true), vault('later', true)]);
    keyring.set('later', (await createVaultKey('1111', { memory: 256, iterations: 1 })).key);
    expect(await repo.recodeVault('later')).toBe(1);
    expect((await store.getCard(card.id))!.payload).toMatch(/^e1:/);
  });
  it('encrypts plaintext left waiting to push once the vault is known to be encrypted', async () => {
    const { store, repo, keyring, key } = await setup();
    keyring.setVaults([vault('vault-me', false)]);
    keyring.forget('secret');
    const card = await repo.createNote({ title: 'Old device edit', vaultId: 'secret' });
    keyring.setVaults([vault('vault-me', false), vault('secret', true)]);
    expect(await repo.pushable()).toEqual([]);
    keyring.set('secret', key);
    const [pending] = await repo.pushable();
    expect(pending.id).toBe(card.id);
    expect(pending.payload).toMatch(/^e1:/);
    expect((await store.getCard(card.id))!.payload).toMatch(/^e1:/);
  });
});
