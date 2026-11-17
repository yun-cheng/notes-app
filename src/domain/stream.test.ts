import { describe, expect, it } from 'vitest';
import { buildIndex } from './cardIndex';
import { parseDateKey } from './dates';
import { datedFilter, daysWhen, entryMatcher, filterParams, filterParts, isFiltered, parseFilter, spanRange, spanSide, streamItems, whenLabel, type TodoStatus } from './stream';
import { doc, note, p, tag, text, todo } from './testFixtures';

const TODAY = '2026-11-12';
const at = (date: string, hour: number) => parseDateKey(date).setHours(hour, 0, 0, 0);

describe('stream', () => {
  const work = tag('work', 'Work');
  const cards = [
    work,
    note('n2', 'Second', { createdAt: at('2026-11-12', 9) }),
    note('n1', 'First', { createdAt: at('2026-11-11', 8), tags: ['work'] }),
    todo('t1', null, { createdAt: at('2026-11-12', 7), tags: ['work'] }),
    note('d2', '', { createdAt: at('2026-11-12', 8), vaultId: 'diary', content: doc(p(text('Rain'))) }),
    note('d1', '', { createdAt: at('2026-11-11', 23), vaultId: 'diary', content: doc(p(text('Sun'))) }),
    note('gone', 'Gone', { createdAt: at('2026-11-12', 6), deleted: true }),
  ];

  it('lists notes and todos in the order they were written, without tags', () => {
    const items = streamItems(buildIndex(cards), {}, TODAY);
    expect(items.map((i) => i.card.id)).toEqual(['n1', 'd1', 't1', 'd2', 'n2']);
    expect(items.map((i) => i.day)).toEqual(['2026-11-11', '2026-11-11', '2026-11-12', '2026-11-12', '2026-11-12']);
  });

  it('keeps only what carries a tag, or sits in a vault', () => {
    const ids = (items: ReturnType<typeof streamItems>) => items.map((i) => i.card.id);
    expect(ids(streamItems(buildIndex(cards), { tagId: 'work' }, TODAY))).toEqual(['n1', 't1']);
    const family = note('fam', 'Family', { createdAt: at('2026-11-12', 11), vaultId: 'family', tags: ['work'] });
    expect(ids(streamItems(buildIndex([...cards, family]), { vaultId: 'family' }, TODAY))).toEqual(['fam']);
    expect(ids(streamItems(buildIndex([...cards, family]), { vaultId: 'v', tagId: 'work' }, TODAY))).toEqual(['n1', 't1']);
  });

  it('shows an entry in a vault it was shared into, besides its own', () => {
    const into = new Map([['n1', ['family']]]);
    const ids = (vaultId: string) => streamItems(buildIndex(cards), { vaultId }, TODAY, into).map((i) => i.card.id);
    expect(ids('family')).toEqual(['n1']);
    expect(ids('v')).toEqual(['n1', 't1', 'n2']);
  });

  it('leaves out what is in a locked vault, diary entries among it', () => {
    expect(streamItems(buildIndex(cards, new Set(['diary'])), {}, TODAY).map((i) => i.card.id)).toEqual(['n1', 't1', 'n2']);
  });

  const ids = (items: ReturnType<typeof streamItems>) => items.map((i) => i.card.id);

  it('narrows by type, vault and when it was written', () => {
    expect(ids(streamItems(buildIndex(cards), { vaultId: 'diary' }, TODAY))).toEqual(['d1', 'd2']);
    expect(ids(streamItems(buildIndex(cards), { when: 'today' }, TODAY))).toEqual(['t1', 'd2', 'n2']);
    expect(ids(streamItems(buildIndex(cards), { when: '2026-11-11', vaultId: 'diary' }, TODAY))).toEqual(['d1']);
    expect(ids(streamItems(buildIndex(cards), { when: 'week', type: 'note' }, TODAY))).toEqual(['n1', 'd1', 'd2', 'n2']);
    expect(parseFilter(new URLSearchParams('type=diary')).type).toBeUndefined();
  });

  it('narrows todos by status and due date', () => {
    const todos = [
      todo('overdue', '2026-11-10', { createdAt: 1 }),
      todo('due-today', TODAY, { createdAt: 2 }),
      todo('later', '2026-11-20', { createdAt: 3 }),
      todo('undated', null, { createdAt: 4 }),
      todo('done', TODAY, { createdAt: 5, status: 'done' }),
      note('n', 'N', { createdAt: 6 }),
      todo('held', TODAY, { createdAt: 7, waiting: true }),
      todo('held-undated', null, { createdAt: 8, waiting: true }),
    ];
    const run = (status: TodoStatus) => ids(streamItems(buildIndex(todos), { status }, TODAY));
    // Waiting todos are open, but not among those due or undated: only under Waiting.
    expect(run('open')).toEqual(['overdue', 'due-today', 'later', 'undated', 'held', 'held-undated']);
    expect(run('waiting')).toEqual(['held', 'held-undated']);
    expect(run('today')).toEqual(['overdue', 'due-today']);
    expect(run('upcoming')).toEqual(['later']);
    expect(run('undated')).toEqual(['undated']);
    expect(run('done')).toEqual(['done']);
  });

  it('puts archived entries away, done or not, until the Archived filter shows them alone', () => {
    const cards = [
      todo('open', TODAY, { createdAt: 1, archived: true }),
      todo('done', TODAY, { createdAt: 2, status: 'done', archived: true }),
      note('kept', 'Kept', { createdAt: 3, archived: true, tags: ['work'] }),
      note('n', 'N', { createdAt: 4, tags: ['work'] }),
      todo('t', TODAY, { createdAt: 5 }),
    ];
    const index = buildIndex(cards);
    expect(ids(streamItems(index, {}, TODAY))).toEqual(['n', 't']);
    expect(ids(streamItems(index, { status: 'today' }, TODAY))).toEqual(['t']);
    expect(ids(streamItems(index, { archived: true }, TODAY))).toEqual(['open', 'done', 'kept']);
    expect(ids(streamItems(index, { archived: true, tagId: 'work' }, TODAY))).toEqual(['kept']);
    expect(ids(streamItems(index, { archived: true, status: 'done' }, TODAY))).toEqual(['done']);
    // Still there for search and links, but not counted among the todos.
    expect(index.live.map((c) => c.id)).toContain('kept');
    expect(index.todos.map((c) => c.id)).toEqual(['t']);
  });
});

describe('entries with links or photos', () => {
  const linked = note('linked', 'L', { createdAt: 1, content: doc(p(text('https://example.com', [{ type: 'link', attrs: { href: 'https://example.com' } }]))) });
  const plainUrl = todo('plain', null, { createdAt: 2, content: doc(p(text('see http://a.example'))) });
  const photo = note('photo', 'P', { createdAt: 3, content: doc({ type: 'photo', attrs: { id: 'p-1' } }) });
  const picture = note('picture', '', { createdAt: 4, content: doc(p(text('look https://img.example/cat.JPG?w=600'))) });
  const ids = (has: 'link' | 'photo') => streamItems(buildIndex([linked, plainUrl, photo, picture, note('n', 'N')]), { has }, TODAY).map((i) => i.card.id);
  it('keeps entries with a web address, linked or typed', () => expect(ids('link')).toEqual(['linked', 'plain', 'picture']));
  it("keeps entries with a photo, or a link straight to a picture, but not a page's link that only previews with one", () =>
    expect(ids('photo')).toEqual(['photo', 'picture']));
});

describe('sorting', () => {
  const ids = (items: ReturnType<typeof streamItems>) => items.map((i) => `${i.card.id}@${i.day}`);
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
    const filter = { sort: 'due', type: 'todo', status: 'today', when: '2026-11-11', tagId: 'work', vaultId: 'v', has: 'photo', archived: true, board: 'status' } as const;
    expect(parseFilter(filterParams(filter))).toEqual(filter);
    expect(parseFilter(new URLSearchParams('type=card&status=x&when=soon&archived=yes'))).toEqual({});
    expect(parseFilter(new URLSearchParams('sort=group:p'))).toEqual({ sort: 'group:p' });
  });

  it('comes apart into chips, each removable on its own, keeping the order', () => {
    const parts = filterParts({ sort: 'due', type: 'todo', status: 'today', when: 'week', tagId: 'work', has: 'link' });
    expect(parts.map((p) => p.part)).toEqual(['type', 'status', 'when', 'tagId', 'has']);
    // The board is how the entries show, like the sort, so it's no chip and doesn't count as a filter.
    expect(filterParts({ board: 'status' })).toEqual([]);
    expect(isFiltered({ board: 'status' })).toBe(false);
    // Taking the type off takes the status with it; taking the status off leaves todos.
    expect(parts[0].without).toEqual({ sort: 'due', type: undefined, status: undefined, when: 'week', tagId: 'work', has: 'link' });
    expect(parts[1].without).toEqual({ sort: 'due', type: 'todo', status: undefined, when: 'week', tagId: 'work', has: 'link' });
    expect(isFiltered(parts[3].without)).toBe(true);
    expect(parts[3].without.tagId).toBeUndefined();
    // A status on its own, as from an older link, still means todos.
    expect(filterParts({ status: 'today' })).toEqual([
      { part: 'type', without: { status: undefined, type: undefined } },
      { part: 'status', without: { status: undefined, type: 'todo' } },
    ]);
    expect(filterParts({ type: 'note', vaultId: 'v' }).map((p) => p.part)).toEqual(['type', 'vaultId']);
    expect(filterParts({ archived: true, has: 'link' })).toEqual([
      { part: 'has', without: { archived: true, has: undefined } },
      { part: 'archived', without: { archived: undefined, has: 'link' } },
    ]);
    expect(filterParts({ sort: 'newest' })).toEqual([]);
  });

  it('narrows the calendar by status, tag, vault and Archived, and leaves the rest to the journal', () => {
    expect(datedFilter({ sort: 'due', board: 'state', type: 'todo', status: 'waiting', tagId: 'work', vaultId: 'v', archived: true })).toEqual({
      status: 'waiting',
      tagId: 'work',
      vaultId: 'v',
      archived: true,
    });
    for (const f of [{ type: 'note' }, { when: 'week' }, { has: 'link' }, { status: 'undated' }] as const) expect(datedFilter(f)).toBeNull();
  });
});

describe('date ranges', () => {
  const day = (id: string, date: string) => note(id, id, { createdAt: at(date, 12) });
  const cards = [day('a', '2026-11-02'), day('b', '2026-11-03'), day('c', '2026-11-06'), day('d', '2026-11-09'), day('e', '2026-11-10')];

  it('makes a range from two days in either order, or one day', () => {
    expect(daysWhen('2026-11-09', '2026-11-03')).toBe('2026-11-03..2026-11-09');
    expect(daysWhen('2026-11-03', '2026-11-03')).toBe('2026-11-03');
  });

  it('keeps the entries written from the first day to the last, both included', () => {
    const shown = streamItems(buildIndex(cards), { when: '2026-11-03..2026-11-09' }, TODAY).map((i) => i.card.id);
    expect(shown).toEqual(['b', 'c', 'd']);
  });

  it('reads a range from the address, and refuses a backwards or broken one', () => {
    expect(parseFilter(new URLSearchParams('when=2026-11-03..2026-11-09')).when).toBe('2026-11-03..2026-11-09');
    expect(parseFilter(new URLSearchParams('when=2026-11-09..2026-11-03')).when).toBeUndefined();
    expect(parseFilter(new URLSearchParams('when=2026-11-03..soon')).when).toBeUndefined();
    expect(entryMatcher({ when: '2026-11-03..2026-11-09' }, TODAY)(cards[0])).toBe(false);
  });

  it('measures a span starting on, ending on, or either side of a day, both ends included', () => {
    expect(spanRange('2026-11-03', { count: 1, unit: 'week', side: 'starting' })).toEqual(['2026-11-03', '2026-11-09']);
    expect(spanRange('2026-11-09', { count: 1, unit: 'week', side: 'ending' })).toEqual(['2026-11-03', '2026-11-09']);
    expect(spanRange('2026-11-09', { count: 1, unit: 'week', side: 'around' })).toEqual(['2026-11-02', '2026-11-16']);
    expect(spanRange('2026-11-09', { count: 3, unit: 'day', side: 'starting' })).toEqual(['2026-11-09', '2026-11-11']);
    expect(spanRange('2026-10-01', { count: 1, unit: 'month', side: 'starting' })).toEqual(['2026-10-01', '2026-10-31']);
    expect(spanRange('2026-03-31', { count: 2, unit: 'year', side: 'ending' })).toEqual(['2024-04-01', '2026-03-31']);
    // A month either side of March 31 reaches each shorter month's last day.
    expect(spanRange('2026-03-31', { count: 1, unit: 'month', side: 'around' })).toEqual(['2026-02-28', '2026-04-30']);
  });

  it('starts from the day unless that would run past today', () => {
    expect(spanSide('2026-10-01', 1, 'month', TODAY)).toBe('starting');
    expect(spanSide('2026-11-06', 1, 'week', TODAY)).toBe('starting');
    expect(spanSide('2026-11-07', 1, 'week', TODAY)).toBe('ending');
  });

  it('names a range briefly, with the year only when it is another', () => {
    // The formatter puts thin spaces around the dash.
    const label = (when: string) => whenLabel(when, TODAY, 'en-US').replace(/\s/g, ' ');
    expect(label('2026-11-03..2026-11-09')).toBe('Nov 3 – 9');
    expect(label('2026-10-28..2026-11-03')).toBe('Oct 28 – Nov 3');
    expect(label('2025-12-28..2026-01-03')).toBe('Dec 28, 2025 – Jan 3, 2026');
  });
});
