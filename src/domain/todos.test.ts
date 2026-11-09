import { describe, expect, it } from 'vitest';
import { parseDateKey } from './dates';
import { todayView, upcomingView } from './todos';
import { todo } from './testFixtures';

describe('todo views', () => {
  const today = '2026-11-10';
  const doneAt = parseDateKey(today).getTime();
  const todos = [
    todo('late', '2026-11-01'),
    todo('now', today),
    todo('soon', '2026-11-12'),
    todo('someday', null),
    todo('finished', today, { status: 'done', completedAt: doneAt }),
    todo('old', '2026-11-02', { status: 'done', completedAt: doneAt - 86400000 * 3 }),
  ];
  it('splits Today into overdue, due and done today', () => {
    const v = todayView(todos, today);
    expect(v.overdue.map((t) => t.id)).toEqual(['late']);
    expect(v.today.map((t) => t.id)).toEqual(['now']);
    expect(v.doneToday.map((t) => t.id)).toEqual(['finished']);
  });
  it('groups Upcoming by date and keeps undated todos', () => {
    const v = upcomingView(todos, today);
    expect(v.days).toEqual([{ date: '2026-11-12', todos: [todos[2]] }]);
    expect(v.noDate.map((t) => t.id)).toEqual(['someday']);
  });
});
