/** Dates are local calendar days stored as YYYY-MM-DD keys, never UTC instants. */

export const MINUTE = 60_000;
export const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDateKey(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateKey(parseDateKey(s)) === s;
}

/** Anchored at noon so a daylight-saving change can't move it to another day. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Six rows of seven date keys covering the month. weekStart: 0 = Sunday, 1 = Monday. */
export function monthGrid(month: string, weekStart: number): string[] {
  const first = parseDateKey(`${month}-01`);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(toDateKey(first), -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function formatDay(key: string, locale?: string): string {
  return parseDateKey(key).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatMonth(month: string, locale?: string): string {
  return parseDateKey(`${month}-01`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function relativeDay(key: string, today: string, locale?: string): string {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  if (key.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
  return parseDateKey(key).toLocaleDateString(locale, opts);
}

/** A time of day as stored: `HH:MM`, 24-hour, local. */
export function isTimeKey(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** `15:00`, `9:30`, `3pm`, `3:30pm`, `9am` or `9a` as a time key. A bare number isn't a time. */
export function parseTime(word: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?([ap]m?)?$/i.exec(word);
  if (!m || (!m[2] && !m[3])) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (minute > 59) return null;
  if (m[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[3][0].toLowerCase() === 'p' ? 12 : 0);
  } else if (hour > 23) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** The time key of a moment, for comparing with a stored time. */
export function toTimeKey(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "3:00 PM" or "15:00", as the locale writes times. */
export function formatTime(key: string, locale?: string): string {
  const [h, m] = key.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** `relativeDay` for the middle of a sentence: "due today", but "due Tue, Nov 10". */
export function relativeDayInSentence(key: string, today: string, locale?: string): string {
  const day = relativeDay(key, today, locale);
  return /^(Today|Tomorrow|Yesterday)$/.test(day) ? day.toLowerCase() : day;
}
