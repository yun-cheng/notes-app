import { describe, expect, it } from 'vitest';
import { rehomeCards } from './rehome';
import { note, tag } from './testFixtures';

describe('rehomeCards', () => {
  it('moves cards from unknown vaults and leaves known ones alone', () => {
    const local = note('a', 'A', { vaultId: 'old' });
    const home = note('b', 'B', { vaultId: 'mine' });
    const [movedA, movedB] = rehomeCards([local, home], new Set(['mine']), 'mine');
    expect(movedA.vaultId).toBe('mine');
    expect(movedA.id).toBe('a');
    expect(movedB).toBe(home);
  });
  it('keeps tag references, because tag IDs do not change', () => {
    const [, moved] = rehomeCards([tag('t', 'T'), note('a', 'A', { tags: ['t'] })], new Set(), 'mine');
    expect(moved.tags).toEqual(['t']);
  });
});
