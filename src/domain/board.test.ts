import { describe, expect, it } from 'vitest';
import { boardColumns, boardTags, columnOf, doneTagOf, groupMove, placeAt, positionOf, stateColumns, stateMove, statusForMove, tagsForStatus } from './board';
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

  describe('the Done column', () => {
    const topics: TagGroup = { ...status, choice: 'many' };

    it('is the tag named Done in a one-choice group', () => {
      expect(doneTagOf(status)?.id).toBe('done');
      expect(doneTagOf(topics)).toBeUndefined();
    });

    it('ticks a todo dragged into it and reopens one dragged out', () => {
      const open = todo('t', null, { tags: ['doing'] });
      const done = todo('t', null, { tags: ['done'], status: 'done', completedAt: 1 });
      expect(statusForMove(open, status, 'doing', 'done')).toBe('done');
      expect(statusForMove(done, status, 'done', 'todo')).toBe('open');
      expect(statusForMove(open, status, 'todo', 'doing')).toBeNull();
      expect(statusForMove(note('n', '', { tags: ['doing'] }), status, 'doing', 'done')).toBeNull();
      expect(statusForMove(open, topics, 'doing', 'done')).toBeNull();
    });

    it('takes a todo there when ticked, and back to the first column when reopened, if it is on the board', () => {
      expect(tagsForStatus(['x', 'doing'], [status], 'done')).toEqual(['x', 'done']);
      expect(tagsForStatus(['done', 'x'], [status], 'open')).toEqual(['x', 'todo']);
      const off = ['x'];
      expect(tagsForStatus(off, [status], 'done')).toBe(off);
      const there = ['done'];
      expect(tagsForStatus(there, [status], 'done')).toBe(there);
    });
  });

  describe('the board by todo state', () => {
    const TODAY = '2026-11-17';
    const open = todo('o', null, { createdAt: 3 });
    const waiting = todo('w', null, { createdAt: 2, waiting: true });
    const done = todo('d', null, { createdAt: 1, status: 'done', completedAt: 1, tags: ['done'] });

    it('puts todos in Open, Waiting and Done, and leaves notes off', () => {
      const columns = stateColumns([open, waiting, done, note('n', 'N')].map(item));
      expect(columns.map((c) => [c.key, ids(c)])).toEqual([
        ['open', ['o']],
        ['waiting', ['w']],
        ['done', ['d']],
      ]);
    });

    it('ticks a todo dragged into Done, moving it to a Done tag too', () => {
      expect(stateMove({ ...open, tags: ['doing'] }, 'done', TODAY, [status])).toEqual({ patch: { status: 'done', tags: ['done'] }, became: 'done' });
      expect(stateMove({ ...waiting }, 'done', TODAY, [status])).toEqual({ patch: { status: 'done', waiting: false }, became: 'done' });
    });

    it('moves a repeating todo on instead, leaving it where it was', () => {
      const weekly = todo('r', '2026-11-17', { repeat: { unit: 'week', every: 1 } });
      expect(stateMove(weekly, 'done', TODAY, [status])).toEqual({ patch: { due: '2026-11-24' }, next: '2026-11-24', became: 'done' });
    });

    it('reopens a done todo, waiting or not, back out of a Done tag', () => {
      expect(stateMove(done, 'open', TODAY, [status])).toEqual({ patch: { status: 'open', tags: ['todo'], waiting: false }, became: 'open' });
      expect(stateMove(done, 'waiting', TODAY, [status])).toEqual({ patch: { status: 'open', tags: ['todo'], waiting: true }, became: 'waiting' });
      expect(stateMove(open, 'waiting', TODAY, [])).toEqual({ patch: { waiting: true }, became: 'waiting' });
      expect(stateMove(waiting, 'open', TODAY, [])).toEqual({ patch: { waiting: false }, became: 'resumed' });
      expect(stateMove(open, 'open', TODAY, [])).toEqual({ patch: {}, became: 'moved' });
    });
  });

  it('moves a card between a group’s columns, ticking it into Done', () => {
    const card = todo('t', null, { tags: ['doing'] });
    expect(groupMove(card, status, 'doing', 'todo', '2026-11-17')).toEqual({ patch: { tags: ['todo'] }, became: 'moved' });
    expect(groupMove(card, status, 'doing', 'done', '2026-11-17')).toEqual({ patch: { tags: ['done'], status: 'done' }, became: 'done' });
  });
});

