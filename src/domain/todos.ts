import type { TodoCard } from './types';
import { toDateKey } from './dates';

const byDue = (a: TodoCard, b: TodoCard) => (a.due ?? '').localeCompare(b.due ?? '') || a.createdAt - b.createdAt;

export interface TodayView {
  overdue: TodoCard[];
  today: TodoCard[];
  doneToday: TodoCard[];
}

export function todayView(todos: TodoCard[], today: string): TodayView {
  const open = todos.filter((t) => t.status === 'open' && t.due !== null).sort(byDue);
  return {
    overdue: open.filter((t) => t.due! < today),
    today: open.filter((t) => t.due === today),
    doneToday: todos.filter((t) => t.status === 'done' && t.completedAt !== null && toDateKey(new Date(t.completedAt)) === today),
  };
}

export interface UpcomingView {
  days: { date: string; todos: TodoCard[] }[];
  noDate: TodoCard[];
}

export function upcomingView(todos: TodoCard[], today: string): UpcomingView {
  const open = todos.filter((t) => t.status === 'open').sort(byDue);
  const days = new Map<string, TodoCard[]>();
  for (const t of open) {
    if (t.due === null || t.due <= today) continue;
    const list = days.get(t.due);
    if (list) list.push(t);
    else days.set(t.due, [t]);
  }
  return {
    days: [...days].map(([date, list]) => ({ date, todos: list })),
    noDate: open.filter((t) => t.due === null),
  };
}

export function todosDueOn(todos: TodoCard[], date: string): TodoCard[] {
  return todos.filter((t) => t.due === date).sort(byDue);
}
