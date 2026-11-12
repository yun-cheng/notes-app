import { describe, expect, it } from 'vitest';
import { todosDueOn } from './todos';
import { todo } from './testFixtures';

describe('todos due on a day', () => {
  it('keeps that day’s todos, done or not, in the order they were written', () => {
    const todos = [todo('b', '2026-11-10', { createdAt: 2 }), todo('a', '2026-11-10', { createdAt: 1, status: 'done' }), todo('c', '2026-11-11'), todo('d', null)];
    expect(todosDueOn(todos, '2026-11-10').map((t) => t.id)).toEqual(['a', 'b']);
  });
});
