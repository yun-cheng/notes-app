import { addDays, daysBetween } from './dates';
import type { TodoCard } from './types';

/**
 * Todos on the month calendar and the timeline: each from its start date to its due date, or on the one day it
 * has. A todo with neither isn't on them.
 */
export interface Span {
  card: TodoCard;
  from: string;
  to: string;
}

export function todoSpan(todo: TodoCard): Span | null {
  const from = todo.start ?? todo.due;
  const to = todo.due ?? todo.start;
  if (!from || !to) return null;
  return from <= to ? { card: todo, from, to } : { card: todo, from: to, to: from };
}

/** The todos' spans, the earliest first, a longer one before a shorter from the same day, then by time and title. */
export function spans(todos: TodoCard[]): Span[] {
  return todos
    .flatMap((t) => todoSpan(t) ?? [])
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        b.to.localeCompare(a.to) ||
        (a.card.dueTime ?? '99').localeCompare(b.card.dueTime ?? '99') ||
        a.card.title.localeCompare(b.card.title) ||
        (a.card.id < b.card.id ? -1 : 1),
    );
}

/**
 * The spans in a run of days (a week of the month, or the timeline's range) in rows ("lanes"), each lane holding
 * spans that don't overlap, so a span keeps one row across the days it covers. Spans come in `spans` order.
 */
export function lanes(days: string[], all: Span[]): Span[][] {
  const first = days[0];
  const last = days[days.length - 1];
  const rows: Span[][] = [];
  for (const span of all) {
    if (span.to < first || span.from > last) continue;
    const row = rows.find((r) => r[r.length - 1].to < span.from);
    if (row) row.push(span);
    else rows.push([span]);
  }
  return rows;
}

/** The span in a lane that covers a day, if any. */
export const spanOn = (lane: Span[], day: string) => lane.find((s) => s.from <= day && day <= s.to);

/** What moving a todo by some days changes: its due date and start date both, so a span keeps its length. */
export function shiftDates(todo: TodoCard, days: number): { due?: string; start?: string } {
  if (!days) return {};
  return {
    ...(todo.due ? { due: addDays(todo.due, days) } : {}),
    ...(todo.start ? { start: addDays(todo.start, days) } : {}),
  };
}

/**
 * Moving one end of a todo's span by some days: its start (a start on its due date is none) or its due date (a todo
 * that only had a start gets one). An end can't pass the other.
 */
export function endPatch(span: Span, end: 'start' | 'end', days: number): { start?: string | null; due?: string } {
  const todo = span.card;
  if (end === 'start') {
    const start = addDays(span.from, days);
    const from = start > span.to ? span.to : start;
    return { start: todo.due && from === todo.due ? null : from };
  }
  const due = addDays(span.to, days);
  return { due: due < span.from ? span.from : due };
}

/** The days a span covers within a run of days, as the index of its first and how many. */
export function placeIn(days: string[], span: Span): { at: number; length: number } | null {
  const first = days[0];
  const last = days[days.length - 1];
  if (span.to < first || span.from > last) return null;
  const from = span.from < first ? first : span.from;
  const to = span.to > last ? last : span.to;
  return { at: daysBetween(first, from), length: daysBetween(from, to) + 1 };
}
