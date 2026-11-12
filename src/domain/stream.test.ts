import { describe, expect, it } from 'vitest';
import { buildIndex } from './cardIndex';
import { parseDateKey } from './dates';
import { filterParams, parseFilter, streamItems, type TodoStatus } from './stream';
import { base, doc, note, p, tag, text, todo } from './testFixtures';
import type { DiaryCard } from './types';

const TODAY = '2026-11-12';
const at = (date: string, hour: number) => parseDateKey(date).setHours(hour, 0, 0, 0);
const body = doc(p(text('x')));
const diary = (date: string, createdAt: number, over: Partial<DiaryCard> = {}): DiaryCard => ({
  ...base, id: `d-${date}`, type: 'diary', date, title: '', content: body, createdAt, ...over,
});

describe('stream', () => {
  const work = tag('work', 'Work');
  const cards = [
    work,
    note('n2', 'Second', { createdAt: at('2026-11-12', 9) }),
    note('n1', 'First', { createdAt: at('2026-11-11', 8), tags: ['work'] }),
    todo('t1', null, { createdAt: at('2026-11-12', 7), tags: ['work'] }),
    diary('2026-11-12', at('2026-11-12', 8)),
    // Written today about yesterday, so it closes yesterday.
    diary('2026-11-11', at('2026-11-12', 10)),
    note('gone', 'Gone', { createdAt: at('2026-11-12', 6), deleted: true }),
  ];

  it('lists notes, todos and diary entries in the order they were written, without tags', () => {
    const items = streamItems(buildIndex(cards), {}, TODAY);
    expect(items.map((i) => (i.kind === 'card' ? i.card.id : i.date))).toEqual(['n1', 'd-2026-11-11', 't1', 'd-2026-11-12', 'n2']);
    expect(items.map((i) => i.day)).toEqual(['2026-11-11', '2026-11-11', '2026-11-12', '2026-11-12', '2026-11-12']);
  });

  it('keeps only what carries a tag, or sits in a vault', () => {
    const ids = (items: ReturnType<typeof streamItems>) => items.map((i) => (i.kind === 'card' ? i.card.id : ''));
    expect(ids(streamItems(buildIndex(cards), { tagId: 'work' }, TODAY))).toEqual(['n1', 't1']);
    const family = note('fam', 'Family', { createdAt: at('2026-11-12', 11), vaultId: 'family', tags: ['work'] });
    expect(ids(streamItems(buildIndex([...cards, family]), { vaultId: 'family' }, TODAY))).toEqual(['fam']);
    expect(ids(streamItems(buildIndex([...cards, family]), { vaultId: 'v', tagId: 'work' }, TODAY))).toEqual(['n1', 't1']);
  });

  it('shows a locked diary entry as a placeholder', () => {
    const locked = diary('2026-11-10', at('2026-11-10', 21), { vaultId: 'private' });
    const items = streamItems(buildIndex([locked, note('n', 'N', { createdAt: at('2026-11-10', 22) })], new Set(['private'])), {}, TODAY);
    expect(items.map((i) => i.kind)).toEqual(['card', 'locked-diary']);
    expect(items[1]).toMatchObject({ kind: 'locked-diary', date: '2026-11-10', vaultId: 'private' });
  });

  const ids = (items: ReturnType<typeof streamItems>) => items.map((i) => (i.kind === 'card' ? i.card.id : i.date));

  it('narrows by type and by when it was written', () => {
    expect(ids(streamItems(buildIndex(cards), { type: 'diary' }, TODAY))).toEqual(['d-2026-11-11', 'd-2026-11-12']);
    expect(ids(streamItems(buildIndex(cards), { when: 'today' }, TODAY))).toEqual(['t1', 'd-2026-11-12', 'n2']);
    expect(ids(streamItems(buildIndex(cards), { when: '2026-11-11' }, TODAY))).toEqual(['n1', 'd-2026-11-11']);
    expect(ids(streamItems(buildIndex(cards), { when: 'week', type: 'note' }, TODAY))).toEqual(['n1', 'n2']);
  });

  it('narrows todos by status and due date', () => {
    const todos = [
      todo('overdue', '2026-11-10', { createdAt: 1 }),
      todo('due-today', TODAY, { createdAt: 2 }),
      todo('later', '2026-11-20', { createdAt: 3 }),
      todo('undated', null, { createdAt: 4 }),
      todo('done', TODAY, { createdAt: 5, status: 'done' }),
      note('n', 'N', { createdAt: 6 }),
    ];
    const run = (status: TodoStatus) => ids(streamItems(buildIndex(todos), { status }, TODAY));
    expect(run('open')).toEqual(['overdue', 'due-today', 'later', 'undated']);
    expect(run('today')).toEqual(['overdue', 'due-today']);
    expect(run('upcoming')).toEqual(['later']);
    expect(run('undated')).toEqual(['undated']);
    expect(run('done')).toEqual(['done']);
  });
});

describe('entries with links or photos', () => {
  const linked = note('linked', 'L', { createdAt: 1, content: doc(p(text('https://example.com', [{ type: 'link', attrs: { href: 'https://example.com' } }]))) });
  const plainUrl = todo('plain', null, { createdAt: 2, content: doc(p(text('see http://a.example'))) });
  const photo = note('photo', 'P', { createdAt: 3, content: doc({ type: 'photo', attrs: { id: 'p-1' } }) });
  const ids = (has: 'link' | 'photo') => streamItems(buildIndex([linked, plainUrl, photo, note('n', 'N')]), { has }, TODAY).map((i) => (i.kind === 'card' ? i.card.id : ''));
  it('keeps entries with a web address, linked or typed', () => expect(ids('link')).toEqual(['linked', 'plain']));
  it('keeps entries with a photo', () => expect(ids('photo')).toEqual(['photo']));
});

describe('sorting', () => {
  const ids = (items: ReturnType<typeof streamItems>) => items.map((i) => (i.kind === 'card' ? `${i.card.id}@${i.day}` : i.date));
  const cards = [
    note('old', 'Old', { createdAt: at('2026-11-10', 9), updatedAt: at(TODAY, 9) }),
    todo('soon', TODAY, { createdAt: at('2026-11-11', 9), updatedAt: at('2026-11-11', 9) }),
    todo('later', '2026-11-20', { createdAt: at('2026-11-09', 9), updatedAt: at('2026-11-09', 9) }),
  ];
  const run = (sort: 'newest' | 'edited' | 'due') => ids(streamItems(buildIndex(cards), { sort }, TODAY));
  it('can put the newest first', () => expect(run('newest')).toEqual(['soon@2026-11-11', 'old@2026-11-10', 'later@2026-11-09']));
  it('can order by last edit, grouped by the day it was edited', () => {
    expect(run('edited')).toEqual(['later@2026-11-09', 'soon@2026-11-11', `old@${TODAY}`]);
  });
  it('can order by due date, with undated entries after', () => expect(run('due')).toEqual([`soon@${TODAY}`, 'later@2026-11-20', 'old@']));
  it('orders a day by due time, with todos due any time that day after', () => {
    const day = [
      todo('any', TODAY, { createdAt: 1 }),
      todo('late', TODAY, { dueTime: '18:00', createdAt: 2 }),
      todo('early', TODAY, { dueTime: '09:00', createdAt: 3 }),
    ];
    expect(ids(streamItems(buildIndex(day), { sort: 'due' }, TODAY))).toEqual([`early@${TODAY}`, `late@${TODAY}`, `any@${TODAY}`]);
  });
  it('can order by an ordered tag group, highest first, each under its tag, then entries with none', () => {
    const prio = { ...tag('p', 'Priority'), members: ['hi', 'lo'], choice: 'one' as const, ordered: true };
    const tagged = [tag('hi', 'High'), tag('lo', 'Low'), prio, { ...cards[0], tags: ['lo'] }, cards[1], { ...cards[2], tags: ['hi'] }];
    expect(ids(streamItems(buildIndex(tagged), { sort: 'group:p' }, TODAY))).toEqual(['later@hi', 'old@lo', 'soon@']);
    // A group that's gone leaves the usual order.
    expect(ids(streamItems(buildIndex(cards), { sort: 'group:p' }, TODAY))).toEqual(['later@2026-11-09', 'old@2026-11-10', 'soon@2026-11-11']);
  });
});

describe('filter in the address', () => {
  it('round-trips, and drops values it does not know', () => {
    const filter = { sort: 'due', type: 'todo', status: 'today', when: '2026-11-11', tagId: 'work', vaultId: 'v', has: 'photo' } as const;
    expect(parseFilter(filterParams(filter))).toEqual(filter);
    expect(parseFilter(new URLSearchParams('type=card&status=x&when=soon'))).toEqual({});
    expect(parseFilter(new URLSearchParams('sort=group:p'))).toEqual({ sort: 'group:p' });
  });
});
