import { describe, expect, it } from 'vitest';
import { boardColumns, boardTags, columnOf, placeAt, positionOf } from './board';
import type { StreamItem } from './stream';
import { buildTagGroups, type TagGroup } from './tagGroups';
import { note, tag, todo } from './testFixtures';
import type { NoteCard, TagCard, TodoCard } from './types';

const group = (id: string, title: string, members: string[], choice: 'one' | 'many' = 'one'): TagCard => ({ ...tag(id, title), members, choice, ordered: true });

const tags = [tag('todo', 'To do'), tag('doing', 'Doing'), tag('done', 'Done'), group('status', 'Status', ['todo', 'doing', 'done'])];
const status = buildTagGroups(tags).groups[0];
const item = (card: NoteCard | TodoCard): StreamItem => ({ card, day: '', at: card.createdAt });
const ids = (column: { items: StreamItem[] }) => column.items.map((i) => i.card.id);

describe('board', () => {
  it('puts each entry in its tag’s column, with entries of none first', () => {
    const cards = [
      note('a', 'A', { createdAt: 1, tags: ['doing'] }),
      todo('b', null, { createdAt: 2 }),
      note('c', 'C', { createdAt: 3, tags: ['todo', 'other'] }),
      note('d', 'D', { createdAt: 4, tags: ['done'] }),
    ];
    const columns = boardColumns(cards.map(item), status);
    expect(columns.map((c) => c.key)).toEqual(['', 'todo', 'doing', 'done']);
    expect(columns.map(ids)).toEqual([['b'], ['c'], ['a'], ['d']]);
    expect(columns[1].tag?.title).toBe('To do');
  });

  it('orders a column by position, and by when written for entries never dragged', () => {
    const cards = [
      note('old', '', { createdAt: 100, tags: ['todo'] }),
      note('new', '', { createdAt: 300, tags: ['todo'] }),
      note('moved', '', { createdAt: 500, position: 200, tags: ['todo'] }),
    ];
    expect(ids(boardColumns(cards.map(item), status)[1])).toEqual(['old', 'moved', 'new']);
    expect(positionOf(cards[2])).toBe(200);
    expect(positionOf(note('x', '', { createdAt: 7, position: Number.NaN }))).toBe(7);
  });

  it('knows an entry’s column', () => {
    expect(columnOf(note('a', '', { tags: ['done'] }), status)).toBe('done');
    expect(columnOf(note('a', '', { tags: ['other'] }), status)).toBe('');
  });

  it('swaps the tag for the new column’s', () => {
    expect(boardTags(['other', 'todo'], status, 'todo', 'done')).toEqual(['other', 'done']);
    expect(boardTags(['other'], status, '', 'doing')).toEqual(['other', 'doing']);
    expect(boardTags(['other', 'todo'], status, 'todo', '')).toEqual(['other']);
    const same = ['todo'];
    expect(boardTags(same, status, 'todo', 'todo')).toBe(same);
  });

  it('in a many-choice group, swaps only the column it left', () => {
    const topics: TagGroup = { ...status, choice: 'many' };
    expect(boardTags(['todo', 'done'], topics, 'todo', 'doing')).toEqual(['done', 'doing']);
    expect(boardTags(['todo', 'done'], topics, 'todo', 'done')).toEqual(['done']);
    expect(boardTags(['todo', 'done', 'x'], topics, 'todo', '')).toEqual(['x']);
  });

  describe('placeAt', () => {
    const at = (id: string, position: number) => note(id, '', { createdAt: position });
    const column = [at('a', 1000), at('b', 2000), at('c', 3000)];

    it('goes halfway between its new neighbours', () => {
      expect(placeAt(column, 1, at('x', 9000))).toEqual(new Map([['x', 1500]]));
    });

    it('goes before the first or after the last', () => {
      expect(placeAt(column, 0, at('x', 9000))).toEqual(new Map([['x', 1000 - 1024]]));
      expect(placeAt(column, 3, at('x', 0))).toEqual(new Map([['x', 3000 + 1024]]));
      expect(placeAt(column, 99, at('x', 0))).toEqual(new Map([['x', 3000 + 1024]]));
    });

    it('stays put when it already sits there', () => {
      expect(placeAt(column, 1, at('x', 1200)).size).toBe(0);
      expect(placeAt([], 0, at('x', 5)).size).toBe(0);
      expect(placeAt(column, 3, at('x', 4000)).size).toBe(0);
    });

    it('spaces the column out when there is no room between', () => {
      const tight = [at('a', 1000), at('b', 1000), at('c', 1000)];
      const placed = placeAt(tight, 1, at('x', 9000));
      expect([...placed.entries()]).toEqual([
        ['x', 2024],
        ['b', 3048],
        ['c', 4072],
      ]);
    });
  });
});
