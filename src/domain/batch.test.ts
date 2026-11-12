import { describe, expect, it } from 'vitest';
import { planBatch, rangeBetween, tagCounts } from './batch';
import { buildTagGroups } from './tagGroups';
import { note, tag, todo } from './testFixtures';

describe('batch edits', () => {
  const a = note('a', 'A', { tags: ['work'] });
  const b = note('b', 'B');
  const t = todo('t', '2026-11-12', { tags: ['work', 'home'] });
  const done = todo('d', null, { status: 'done' });

  it('adds a tag only where it is missing, with an undo', () => {
    expect(planBatch([a, b, t], { kind: 'add-tag', tagId: 'work' })).toEqual([{ id: 'b', patch: { tags: ['work'] }, undo: { tags: [] } }]);
  });

  it('removes a tag only where it is', () => {
    expect(planBatch([a, b, t], { kind: 'remove-tag', tagId: 'work' })).toEqual([
      { id: 'a', patch: { tags: [] }, undo: { tags: ['work'] } },
      { id: 't', patch: { tags: ['home'] }, undo: { tags: ['work', 'home'] } },
    ]);
  });

  it('changes status and due dates on todos only', () => {
    expect(planBatch([a, t, done], { kind: 'status', status: 'done' }).map((s) => s.id)).toEqual(['t']);
    expect(planBatch([a, t, done], { kind: 'due', due: null })).toEqual([{ id: 't', patch: { due: null }, undo: { due: '2026-11-12' } }]);
  });

  it('moves a repeating todo on instead of finishing it', () => {
    const gym = todo('g', '2026-11-12', { repeat: { unit: 'day', every: 2 } });
    expect(planBatch([t, gym], { kind: 'status', status: 'done' }, new Map(), '2026-11-12')).toEqual([
      { id: 't', patch: { status: 'done' }, undo: { status: 'open' } },
      { id: 'g', patch: { due: '2026-11-14' }, undo: { due: '2026-11-12' } },
    ]);
  });

  it('takes the time and repeat off with the due date', () => {
    const gym = todo('g', '2026-11-12', { dueTime: '18:00', repeat: { unit: 'week', every: 1 } });
    expect(planBatch([gym], { kind: 'due', due: null })).toEqual([
      { id: 'g', patch: { due: null, dueTime: null, repeat: null }, undo: { due: '2026-11-12', dueTime: '18:00', repeat: { unit: 'week', every: 1 } } },
    ]);
  });

  it('swaps a tag from a one-choice group for the one already there', () => {
    const prio = buildTagGroups([tag('hi', 'High'), tag('lo', 'Low'), { ...tag('p', 'Priority'), members: ['hi', 'lo'], choice: 'one' }]);
    const high = note('x', 'X', { tags: ['work', 'hi'] });
    expect(planBatch([high], { kind: 'add-tag', tagId: 'lo' }, prio.groupOf)).toEqual([{ id: 'x', patch: { tags: ['work', 'lo'] }, undo: { tags: ['work', 'hi'] } }]);
  });

  it('never touches tag cards', () => {
    expect(planBatch([tag('x', 'X')], { kind: 'add-tag', tagId: 'work' })).toEqual([]);
  });

  it('counts tags across the selection, most common first', () => {
    expect(tagCounts([a, b, t])).toEqual([
      { tagId: 'work', count: 2 },
      { tagId: 'home', count: 1 },
    ]);
  });

  it('selects a range in either direction', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'gone', 'c')).toEqual(['c']);
  });
});
