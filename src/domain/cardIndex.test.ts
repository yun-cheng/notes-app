import { describe, expect, it } from 'vitest';
import { buildIndex, cardText, resolveTags } from './cardIndex';
import { doc, link, note, p, tag } from './testFixtures';

describe('index', () => {
  const t = tag('t', 'Work', true);
  const a = note('a', 'A', { tags: ['t'], content: doc(p(link('b', 'old name'), link('a', 'self'))) });
  const b = note('b', 'B');
  const gone = note('gone', 'Gone', { deleted: true, content: doc(p(link('b', 'B'))), tags: ['t'] });
  const index = buildIndex([t, a, b, gone, note('blank', '')]);

  it('derives tag and link backlinks, without self-links', () => {
    expect(index.backlinks.get('t')?.map((l) => [l.from.id, l.kind])).toEqual([['a', 'tag']]);
    expect(index.backlinks.get('b')?.map((l) => [l.from.id, l.kind])).toEqual([['a', 'link']]);
    expect(index.backlinks.get('a')).toBeUndefined();
  });
  it('hides deleted and blank cards from lists but keeps them addressable', () => {
    expect(index.live.map((c) => c.id).sort()).toEqual(['a', 'b', 't']);
    expect(index.byId.has('blank')).toBe(true);
    expect(index.trash.map((c) => c.id)).toEqual(['gone']);
  });
  it('lists pinned tags as folders', () => expect(index.pinnedTags.map((c) => c.id)).toEqual(['t']));
  it('shows links under the current title in previews', () => {
    expect(cardText(index, a)).toBe('BA');
    expect(cardText(buildIndex([a]), a)).toBe('old nameA');
  });
  it('ignores deleted tags when resolving', () => {
    const i = buildIndex([{ ...t, deleted: true }, a]);
    expect(resolveTags(i, a.tags)).toEqual([]);
  });
});
