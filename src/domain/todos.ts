import type { TodoCard } from './types';

/** Todos due on a day, in the order they were written. Today and Upcoming are journal filters now, in stream.ts. */
export function todosDueOn(todos: TodoCard[], date: string): TodoCard[] {
  return todos.filter((t) => t.due === date).sort((a, b) => a.createdAt - b.createdAt);
}
