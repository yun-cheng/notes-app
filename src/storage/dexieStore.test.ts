import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
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
    const vault = { id: 'v', name: 'P', owner_id: 'l', lock: 'none' as const, ai_access: 'off' as const, created_at: 1, pin: null, hidden: false };
    await dx.putVaults([vault]);
    expect(await dx.listVaults()).toEqual([vault]);
  });
  it('keeps photos and lists the ones waiting to upload, oldest first', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    const photo = (id: string, addedAt: number) => ({ id, vaultId: 'v', blob: new Blob(['x']), mime: 'image/jpeg', width: 1, height: 1, uploaded: 0 as const, addedAt });
    await dx.putPhoto(photo('b', 2));
    await dx.putPhoto(photo('a', 1));
    expect((await dx.pendingPhotos()).map((p) => p.id)).toEqual(['a', 'b']);
    await dx.markPhotoUploaded('a');
    expect((await dx.pendingPhotos()).map((p) => p.id)).toEqual(['b']);
    expect((await dx.getPhoto('a'))?.uploaded).toBe(1);
  });
  it('counts what isn\'t on the server yet: changes and photos waiting to go up', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    expect(await dx.unsent()).toBe(0);
    await dx.putCards([rec('a')]);
    await dx.putPhoto({ id: 'p', vaultId: 'v', blob: new Blob(['x']), mime: 'image/jpeg', width: 1, height: 1, uploaded: 0, addedAt: 1 });
    expect(await dx.unsent()).toBe(2);
    await dx.markSynced('a', 1, 5);
    await dx.markPhotoUploaded('p');
    expect(await dx.unsent()).toBe(0);
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
  it('keeps what subscribers have up to date with its own writes, in ID order, without reading every card again', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    await dx.putCards([rec('b'), rec('d')]);
    const seen: string[][] = [];
    const stop = dx.subscribe((records) => seen.push(records.map((r) => `${r.id}${r.seq}`)));
    // Written while every card is first read: in what's given, whether or not the read saw it.
    await dx.putCards([rec('c')]);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['b0', 'c0', 'd0']));
    const reads = vi.spyOn((dx as unknown as { db: { cards: { toArray: () => Promise<unknown> } } }).db.cards, 'toArray');
    await dx.putCards([rec('a')]);
    expect(seen.at(-1)).toEqual(['a0', 'b0', 'c0', 'd0']);
    await dx.markSynced('a', 1, 7);
    await dx.applyRemote([{ ...rec('e'), seq: 3 }, { ...rec('b'), seq: 0 }]);
    await dx.forceRemote({ ...rec('c'), seq: 9 });
    await dx.deleteCards(['d']);
    expect(seen.at(-1)).toEqual(['a7', 'b0', 'c9', 'e3']);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
    stop();
  });
  it('reads every card again when another tab writes', async () => {
    const name = `t-${Math.random()}`;
    const here = new DexieStore(name);
    const there = new DexieStore(name);
    const seen: number[] = [];
    const stop = here.subscribe((records) => seen.push(records.length));
    await vi.waitFor(() => expect(seen).toEqual([0]));
    await there.putCards([rec('a'), rec('b')]);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(2));
    stop();
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
  it('keeps a card edited since, when asked to', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    await dx.putCards([rec('a', 6)]);
    expect(await dx.forceRemote({ ...rec('a', 9), seq: 2 }, 5)).toBe(false);
    expect((await dx.getCard('a'))?.updated_at).toBe(6);
    expect(await dx.listDirty()).toHaveLength(1);
    expect(await dx.forceRemote({ ...rec('a', 9), seq: 2 }, 6)).toBe(true);
    expect((await dx.getCard('a'))?.updated_at).toBe(9);
  });
  it('stores metadata', async () => {
    const dx = new DexieStore(`t-${Math.random()}`);
    expect(await dx.getMeta('cursor')).toBeUndefined();
    await dx.setMeta('cursor', 12);
    expect(await dx.getMeta('cursor')).toBe(12);
  });
  it('keeps translations, one per entry, and drops them with the database', async () => {
    const name = `t-${Math.random()}`;
    const dx = new DexieStore(name);
    const t = { cardId: 'a', source: 'こんにちは', pieces: ['Hello'], from: 'ja', to: 'en', shown: true, savedAt: 1 };
    await dx.putTranslation(t);
    await dx.putTranslation({ ...t, shown: false });
    expect(await dx.listTranslations()).toEqual([{ ...t, shown: false }]);
    await dx.deleteTranslations(['a']);
    expect(await dx.listTranslations()).toEqual([]);
    await dx.putTranslation(t);
    await dx.destroy();
    expect(await new DexieStore(name).listTranslations()).toEqual([]);
  });
});
