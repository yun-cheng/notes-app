import { toTimeKey } from './dates';
import { nextDue } from './repeat';
import type { TodoCard } from './types';

/** Todos due on a day, in the order they were written. Today and Upcoming are journal filters now, in stream.ts. */
export function todosDueOn(todos: TodoCard[], date: string): TodoCard[] {
  return todos.filter((t) => t.due === date).sort((a, b) => a.createdAt - b.createdAt);
}

/** Open and past its due date, or due today at a time already gone. */
export function isOverdue(todo: TodoCard, today: string, now = toTimeKey(new Date())): boolean {
  if (todo.status !== 'open' || !todo.due) return false;
  return todo.due < today || (todo.due === today && !!todo.dueTime && todo.dueTime <= now);
}

export interface Completion {
  patch: { status?: 'done'; due?: string };
  undo: { status?: 'open'; due?: string | null };
  /** For a repeating todo, when it's due next. */
  next?: string;
}

/** What ticking an open todo changes. A repeating one stays open and moves on to its next due date. */
export function completeTodo(todo: TodoCard, today: string): Completion {
  if (!todo.repeat) return { patch: { status: 'done' }, undo: { status: 'open' } };
  const next = nextDue(todo.due, todo.repeat, today);
  return { patch: { due: next }, undo: { due: todo.due }, next };
}
