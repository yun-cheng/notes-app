import { addDays, parseDateKey, toDateKey } from './dates';
import type { Repeat, RepeatUnit } from './types';

/**
 * Repeating todos. A repeating todo is one card that stays open: ticking it moves its due date to the next time,
 * so it never piles up copies in the journal. Its history keeps each tick.
 */

const UNITS: readonly RepeatUnit[] = ['day', 'week', 'month', 'year', 'weekday'];
const MAX_EVERY = 999;

export function isRepeat(v: unknown): v is Repeat {
  if (typeof v !== 'object' || v === null) return false;
  const { unit, every } = v as Repeat;
  return UNITS.includes(unit) && Number.isInteger(every) && every >= 1 && every <= MAX_EVERY && (unit !== 'weekday' || every === 1);
}

const isWeekend = (key: string) => {
  const day = parseDateKey(key).getDay();
  return day === 0 || day === 6;
};

/** Whole months later, on the same day of the month, or the month's last day when it's shorter (Jan 31 → Feb 28). */
function addMonthsClamped(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(d, last));
  return toDateKey(target);
}

function step(from: string, repeat: Repeat, times: number): string {
  switch (repeat.unit) {
    case 'day':
      return addDays(from, repeat.every * times);
    case 'week':
      return addDays(from, 7 * repeat.every * times);
    case 'month':
      return addMonthsClamped(from, repeat.every * times);
    case 'year':
      return addMonthsClamped(from, 12 * repeat.every * times);
    case 'weekday': {
      let day = from;
      for (let i = 0; i < times; i++) do day = addDays(day, 1); while (isWeekend(day));
      return day;
    }
  }
}

/** The first due date for a new repeating todo with no date of its own: today, or for weekdays the next weekday. */
export function firstDue(repeat: Repeat, today: string): string {
  return repeat.unit === 'weekday' && isWeekend(today) ? step(today, repeat, 1) : today;
}

/**
 * The due date after `due` (today when it has none). One that fell behind skips ahead to the first time after
 * today, keeping its rhythm: a weekly todo due last Monday, ticked on Wednesday, is next due Monday.
 */
export function nextDue(due: string | null, repeat: Repeat, today: string): string {
  const from = due ?? today;
  if (repeat.unit === 'weekday') return step(from > today ? from : today, repeat, 1);
  let times = 1;
  let next = step(from, repeat, 1);
  // Counted from `from` each time, so a month's day isn't worn down by short months on the way.
  while (next <= today) next = step(from, repeat, ++times);
  return next;
}

const NAMES: Record<Exclude<RepeatUnit, 'weekday'>, [single: string, plural: string]> = {
  day: ['Daily', 'days'],
  week: ['Weekly', 'weeks'],
  month: ['Monthly', 'months'],
  year: ['Yearly', 'years'],
};

/** "Weekly", "Every 2 weeks", "Every weekday". */
export function repeatLabel(repeat: Repeat): string {
  if (repeat.unit === 'weekday') return 'Every weekday';
  const [single, plural] = NAMES[repeat.unit];
  return repeat.every === 1 ? single : `Every ${repeat.every} ${plural}`;
}

const WORDS: Record<string, RepeatUnit> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year', weekdays: 'weekday' };

/** `@daily`, `@weekly`, `@monthly`, `@yearly`, `@weekdays`, or `@every-2-weeks`, `@every-day` and the like. */
export function parseRepeat(word: string): Repeat | null {
  const w = word.toLowerCase();
  if (WORDS[w]) return { unit: WORDS[w], every: 1 };
  const m = /^every-(?:(\d{1,3})-)?(day|week|month|year|weekday)s?$/.exec(w);
  if (!m) return null;
  const repeat = { unit: m[2] as RepeatUnit, every: m[1] ? Number(m[1]) : 1 };
  return isRepeat(repeat) ? repeat : null;
}

/** The word `parseRepeat` reads back: `weekly`, `every-2-weeks`, `weekdays`. */
export function repeatWord(repeat: Repeat): string {
  if (repeat.unit === 'weekday') return 'weekdays';
  return repeat.every === 1 ? NAMES[repeat.unit][0].toLowerCase() : `every-${repeat.every}-${repeat.unit}s`;
}

/** The choices offered in a todo's Repeat menu. A todo can hold others, typed as `@every-3-days`. */
export const REPEAT_CHOICES: Repeat[] = [
  { unit: 'day', every: 1 },
  { unit: 'weekday', every: 1 },
  { unit: 'week', every: 1 },
  { unit: 'week', every: 2 },
  { unit: 'month', every: 1 },
  { unit: 'year', every: 1 },
];
