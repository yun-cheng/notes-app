import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diaryId } from '../domain/rehome';
import type { Vault } from '../domain/types';
import { DexieStore } from './dexieStore';
import { localStorageJournal } from './journal';
import { claimLegacyNotes } from './legacy';
import { CardRepository } from './repository';
import { jsonCodec } from './types';

const vault: Vault = { id: 'server-vault', name: 'Personal', owner_id: 'u', lock: 'none', ai_access: 'off', created_at: 1 };

async function account() {
  const store = new DexieStore(`acct-${Math.random()}`);
  await store.putVaults([vault]);
  const repo = new CardRepository(store, jsonCodec);
  await repo.init();
  return { store, repo };
}

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

describe('claimLegacyNotes', () => {
  it('does nothing when there are no earlier notes', async () => {
    const { repo, store } = await account();
    expect(await claimLegacyNotes(repo)).toBe(0);
    expect(await store.listCards()).toEqual([]);
  });

  it('moves earlier notes into the account, ready to sync, and removes the old copy', async () => {
    const legacyStore = new DexieStore('notes-app');
    const legacy = new CardRepository(legacyStore, jsonCodec);
    const oldVault = await legacy.init();
    await legacy.createNote({ title: 'Kept note' });
    const deleted = await legacy.createNote({ title: 'Trashed' });
    await legacy.setDeleted(deleted.id, true);
    await legacy.saveDiary('2026-11-10', { content: { type: 'doc', content: [] } });
    expect(oldVault.id).not.toBe(vault.id);

    const { repo, store } = await account();
    expect(await claimLegacyNotes(repo)).toBe(3);

    const cards = await Promise.all((await store.listCards()).map((r) => repo.decode(r)));
    expect(cards.every((c) => c.vaultId === vault.id)).toBe(true);
    expect(cards.map((c) => c.id)).toContain(diaryId(vault.id, '2026-11-10'));
    expect(cards.find((c) => c.title === 'Trashed')?.deleted).toBe(true);
    expect(await store.listDirty()).toHaveLength(3);
    expect(await Dexie.exists('notes-app')).toBe(false);
    expect(await claimLegacyNotes(repo)).toBe(0);
  });

  it('recovers an edit still in the old journal', async () => {
    const journal = localStorageJournal('notes-app:journal');
    const legacyStore = new DexieStore('notes-app');
    const legacy = new CardRepository(legacyStore, jsonCodec);
    const card = await legacy.createNote({ title: 'before' });
    journal.save([{ kind: 'update', at: card.updatedAt + 1, id: card.id, patch: { title: 'after' } }]);

    const { repo, store } = await account();
    await claimLegacyNotes(repo);
    expect((await repo.decode((await store.listCards())[0])).title).toBe('after');
    expect(localStorage.getItem('notes-app:journal')).toBeNull();
  });
});
