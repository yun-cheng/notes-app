import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DexieStore } from './dexieStore';
import { EMPTY_DOC, type CardRecord } from '../domain/types';

describe('DexieStore', () => {
  const rec = (id: string, updated_at = 1): CardRecord => ({ id, vault_id: 'v', updated_at, deleted: false, seq: 0, payload: JSON.stringify({ type: 'note', title: id, content: EMPTY_DOC, tags: [], createdAt: 1 }) });

  it('persists records and vaults', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    await dx.putCards([rec('a'), rec('b')]);
    await dx.putCards([rec('a', 2)]);
    expect((await dx.getCard('a'))?.updated_at).toBe(2);
    expect(await dx.listCards()).toHaveLength(2);
    expect(await dx.getCard('zzz')).toBeUndefined();
    const vault = { id: 'v', name: 'P', owner_id: 'l', lock: 'none' as const, ai_access: 'off' as const, created_at: 1 };
    await dx.putVaults([vault]);
    expect(await dx.listVaults()).toEqual([vault]);
  });
  it('notifies subscribers of later writes', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    const counts: number[] = [];
    const seen = new Promise<void>((resolve) => {
      const stop = dx.subscribe((records) => {
        counts.push(records.length);
        if (records.length === 1) { stop(); resolve(); }
      });
    });
    await dx.putCards([rec('a')]);
    await seen;
    expect(counts.at(-1)).toBe(1);
  });
  it('tracks unpushed changes and protects them from remote updates', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    await dx.putCards([rec('a', 5)]);
    expect((await dx.listDirty()).map((r) => r.id)).toEqual(['a']);
    await dx.applyRemote([{ ...rec('a', 9), seq: 3 }, { ...rec('b', 9), seq: 4 }]);
    expect((await dx.getCard('a'))?.updated_at).toBe(5);
    expect((await dx.getCard('b'))?.seq).toBe(4);
    expect((await dx.listDirty()).map((r) => r.id)).toEqual(['a']);
  });
  it('keeps a card dirty if it changed after the push began', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    await dx.putCards([rec('a', 5)]);
    await dx.markSynced('a', 4, 10);
    expect((await dx.getCard('a'))?.seq).toBe(10);
    expect(await dx.listDirty()).toHaveLength(1);
    await dx.markSynced('a', 5, 11);
    expect(await dx.listDirty()).toHaveLength(0);
  });
  it('replaces a card outright with the server version', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    await dx.putCards([rec('a', 5)]);
    await dx.forceRemote({ ...rec('a', 9), seq: 2 });
    expect((await dx.getCard('a'))?.updated_at).toBe(9);
    expect(await dx.listDirty()).toHaveLength(0);
  });
  it('stores metadata', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    expect(await dx.getMeta('cursor')).toBeUndefined();
    await dx.setMeta('cursor', 12);
    expect(await dx.getMeta('cursor')).toBe(12);
  });
});
