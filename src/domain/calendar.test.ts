import { describe, expect, it } from 'vitest';
import { lanes, placeIn, shiftDates, spanOn, spans, todoSpan } from './calendar';
import { todo } from './testFixtures';

const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];

describe('the calendar', () => {
  it('puts a todo from its start to its due date, or on its one date', () => {
    expect(todoSpan(todo('a', '2026-11-20', { start: '2026-11-17' }))).toMatchObject({ from: '2026-11-17', to: '2026-11-20' });
    expect(todoSpan(todo('b', '2026-11-20'))).toMatchObject({ from: '2026-11-20', to: '2026-11-20' });
    expect(todoSpan(todo('c', null, { start: '2026-11-18' }))).toMatchObject({ from: '2026-11-18', to: '2026-11-18' });
    expect(todoSpan(todo('d', '2026-11-17', { start: '2026-11-20' }))).toMatchObject({ from: '2026-11-17', to: '2026-11-20' });
    expect(todoSpan(todo('e', null))).toBeNull();
  });

  it('lays spans in lanes that never overlap, so each keeps its row', () => {
    const all = spans([
      todo('long', '2026-11-21', { start: '2026-11-16' }),
      todo('one', '2026-11-17'),
      todo('two', '2026-11-22'),
      todo('later', '2026-12-01'),
      todo('before', '2026-11-10'),
    ]);
    const rows = lanes(week, all);
    expect(rows.map((r) => r.map((s) => s.card.id))).toEqual([['long', 'two'], ['one']]);
    expect(spanOn(rows[0], '2026-11-19')?.card.id).toBe('long');
    expect(spanOn(rows[1], '2026-11-19')).toBeUndefined();
  });

  it('places a span in a run of days, cut at its ends', () => {
    expect(placeIn(week, { card: todo('a', null), from: '2026-11-14', to: '2026-11-18' })).toEqual({ at: 0, length: 3 });
    expect(placeIn(week, { card: todo('a', null), from: '2026-11-21', to: '2026-11-30' })).toEqual({ at: 5, length: 2 });
    expect(placeIn(week, { card: todo('a', null), from: '2026-11-01', to: '2026-11-02' })).toBeNull();
  });

  it('moves both dates, so a span keeps its length', () => {
    expect(shiftDates(todo('a', '2026-11-20', { start: '2026-11-17' }), 3)).toEqual({ due: '2026-11-23', start: '2026-11-20' });
    expect(shiftDates(todo('b', '2026-11-20'), -1)).toEqual({ due: '2026-11-19' });
    expect(shiftDates(todo('c', '2026-11-20'), 0)).toEqual({});
  });
});
