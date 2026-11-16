import { addDays, daysBetween, toTimeKey } from './dates';
import { nextDue } from './repeat';
import type { TodoCard } from './types';

/** Todos due on a day, in the order they were written. Today and Upcoming are journal filters now, in stream.ts. */
export function todosDueOn(todos: TodoCard[], date: string): TodoCard[] {
  return todos.filter((t) => t.due === date).sort((a, b) => a.createdAt - b.createdAt);
}

/** Open and past its due date, or due today at a time already gone. A waiting todo never is. */
export function isOverdue(todo: TodoCard, today: string, now = toTimeKey(new Date())): boolean {
  if (todo.status !== 'open' || todo.waiting || !todo.due) return false;
  return todo.due < today || (todo.due === today && !!todo.dueTime && todo.dueTime <= now);
}

export interface Completion {
  patch: { status?: 'done'; due?: string; start?: string; waiting?: false };
  undo: { status?: 'open'; due?: string | null; start?: string | null; waiting?: true };
  /** For a repeating todo, when it's due next. */
  next?: string;
}

/**
 * What ticking an open todo changes. A repeating one stays open and moves on to its next due date, its start date
 * moving as far. Either way it's no longer waiting: what it waited for has come.
 */
export function completeTodo(todo: TodoCard, today: string): Completion {
  const wait = todo.waiting ? ({ patch: { waiting: false }, undo: { waiting: true } } as const) : { patch: {}, undo: {} };
  if (!todo.repeat) return { patch: { status: 'done', ...wait.patch }, undo: { status: 'open', ...wait.undo } };
  const next = nextDue(todo.due, todo.repeat, today);
  const start = todo.start && todo.due ? { patch: { start: addDays(todo.start, daysBetween(todo.due, next)) }, undo: { start: todo.start } } : { patch: {}, undo: {} };
  return { patch: { due: next, ...start.patch, ...wait.patch }, undo: { due: todo.due, ...start.undo, ...wait.undo }, next };
}
