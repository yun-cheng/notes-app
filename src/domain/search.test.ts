import { describe, expect, it } from 'vitest';
import { buildIndex } from './cardIndex';
import { buildSearch, tokenize } from './search';
import { doc, note, p, tag, text } from './testFixtures';
import type { Card } from './types';

describe('search', () => {
  const t = tag('t', 'Travel');
  const cards: Card[] = [
    t,
    note('a', 'Kyoto itinerary', { tags: ['t'], content: doc(p(text('Temples and gardens in autumn'))) }),
    note('b', 'Groceries', { content: doc(p(text('oat milk, garden peas'))) }),
    note('c', '高中同学聚会', { content: doc(p(text('十一月的计划 with friends'))) }),
    note('d', 'Deleted temple', { deleted: true }),
  ];
  const search = buildSearch(buildIndex(cards));
  const ids = (q: string) => search.search(q).map((h) => h.card.id);

  it('matches title and body by prefix', () => {
    expect(ids('kyo')).toEqual(['a']);
    expect(ids('garden').sort()).toEqual(['a', 'b']);
  });
  it('requires every term', () => expect(ids('garden temples')).toEqual(['a']));
  it('finds cards by tag name', () => expect(ids('travel')).toContain('a'));
  it('tolerates a small typo', () => expect(ids('itinerery')).toEqual(['a']));
  it('does not return deleted cards', () => expect(ids('deleted')).toEqual([]));
  it('finds Chinese text inside a longer run', () => {
    expect(ids('同学')).toEqual(['c']);
    expect(ids('计划')).toEqual(['c']);
  });
  it('tokenizes mixed scripts', () => expect(tokenize('Hi 同学, ok_1')).toEqual(['Hi', '同', '学', 'ok_1']));
  it('returns nothing for an empty query', () => expect(ids('   ')).toEqual([]));
  it('shows a snippet around the match', () => {
    expect(search.search('autumn')[0].snippet).toContain('autumn');
  });
});
