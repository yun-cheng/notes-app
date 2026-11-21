import { describe, expect, it } from 'vitest';
import { offeredIn, tagNamedIn, tagsFor, tagsForAll } from './tagScope';
import { EMPTY_DOC, type TagCard } from './types';

const tag = (id: string, title: string, vaultId: string, kept = false): TagCard => ({
  id, title, vaultId, type: 'tag', content: EMPTY_DOC, tags: [], pinned: false, createdAt: 1, updatedAt: 1, deleted: false, seq: 0,
  ...(kept ? { scope: 'vault' as const } : {}),
});

describe('tag scope', () => {
  const work = tag('work', 'Work', 'personal');
  const homeHere = tag('home-family', 'Home', 'family', true);
  const homeEverywhere = tag('home', 'Home', 'personal');
  const trip = tag('trip', 'Trip', 'family', true);
  const tags = [work, homeEverywhere, homeHere, trip];

  it('offers a tag kept to a vault only on entries there, and one for all vaults everywhere', () => {
    expect(offeredIn(trip, 'family')).toBe(true);
    expect(offeredIn(trip, 'personal')).toBe(false);
    expect(offeredIn(work, 'family')).toBe(true);
    expect(tagsFor(tags, 'personal').map((t) => t.id)).toEqual(['work', 'home']);
  });
  it("finds a typed name in the vault's own tags first", () => {
    expect(tagNamedIn(tags, 'home', 'family')?.id).toBe('home-family');
    expect(tagNamedIn(tags, 'HOME', 'personal')?.id).toBe('home');
    expect(tagNamedIn(tags, 'trip', 'personal')).toBeUndefined();
  });
  it('offers several entries only the tags every one of them may take', () => {
    expect(tagsForAll(tags, ['family', 'personal']).map((t) => t.id)).toEqual(['work', 'home']);
    expect(tagsForAll(tags, ['family']).map((t) => t.id)).toEqual(['work', 'home', 'home-family', 'trip']);
  });
});
