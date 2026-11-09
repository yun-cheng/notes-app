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
});
