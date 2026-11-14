import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../storage/memoryStore';
import { Unsynced } from './unsynced';

const record = (id: string, updated_at = 1) => ({ id, vault_id: 'v', updated_at, deleted: false, seq: 0, payload: '{}' });

describe('Unsynced', () => {
  it('tells listeners only when the set changes', () => {
    const unsynced = new Unsynced();
    let calls = 0;
    unsynced.subscribe(() => calls++);
    unsynced.set(['a', 'b']);
    const first = unsynced.getIds();
    unsynced.set(['b', 'a']);
    expect(calls).toBe(1);
    expect(unsynced.getIds()).toBe(first);
    unsynced.set(['a']);
    expect(calls).toBe(2);
    expect([...unsynced.getIds()]).toEqual(['a']);
  });

  it('follows the store as cards are saved and sent', async () => {
    const store = new MemoryStore();
    const unsynced = new Unsynced();
    store.subscribeDirty((ids) => unsynced.set(ids));
    await store.putCards([record('a'), record('b')]);
    expect(unsynced.getIds()).toEqual(new Set(['a', 'b']));
    await store.markSynced('a', 1, 5);
    expect(unsynced.getIds()).toEqual(new Set(['b']));
    // Changed again while the push was on its way: still waiting.
    await store.putCards([record('b', 2)]);
    await store.markSynced('b', 1, 6);
    expect(unsynced.getIds()).toEqual(new Set(['b']));
  });
});
