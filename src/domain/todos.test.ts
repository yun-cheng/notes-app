import { describe, expect, it } from 'vitest';
import { completeTodo, isOverdue, todosDueOn } from './todos';
import { todo } from './testFixtures';

describe('todos due on a day', () => {
  it('keeps that day’s todos, done or not, in the order they were written', () => {
    const todos = [todo('b', '2026-11-10', { createdAt: 2 }), todo('a', '2026-11-10', { createdAt: 1, status: 'done' }), todo('c', '2026-11-11'), todo('d', null)];
    expect(todosDueOn(todos, '2026-11-10').map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('ticking a todo', () => {
  const TODAY = '2026-11-12';
  it('finishes a todo that does not repeat', () => {
    expect(completeTodo(todo('t', TODAY), TODAY)).toEqual({ patch: { status: 'done' }, undo: { status: 'open' } });
  });
  it('moves a repeating todo to its next due date, and back on undo', () => {
    expect(completeTodo(todo('t', TODAY, { repeat: { unit: 'week', every: 1 } }), TODAY)).toEqual({
      patch: { due: '2026-11-19' },
      undo: { due: TODAY },
      next: '2026-11-19',
    });
  });
});

describe('overdue', () => {
  const TODAY = '2026-11-12';
  it('is past its day, or due today at a time already gone', () => {
    expect(isOverdue(todo('a', '2026-11-11'), TODAY, '08:00')).toBe(true);
    expect(isOverdue(todo('b', TODAY), TODAY, '23:59')).toBe(false);
    expect(isOverdue(todo('c', TODAY, { dueTime: '09:00' }), TODAY, '09:00')).toBe(true);
    expect(isOverdue(todo('d', TODAY, { dueTime: '09:00' }), TODAY, '08:59')).toBe(false);
    expect(isOverdue(todo('e', '2026-11-11', { status: 'done' }), TODAY, '08:00')).toBe(false);
  });
});
