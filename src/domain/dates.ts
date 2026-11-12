/** Dates are local calendar days stored as YYYY-MM-DD keys, never UTC instants. */

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

/** `relativeDay` for the middle of a sentence: "due today", but "due Tue, Nov 10". */
export function relativeDayInSentence(key: string, today: string, locale?: string): string {
  const day = relativeDay(key, today, locale);
  return /^(Today|Tomorrow|Yesterday)$/.test(day) ? day.toLowerCase() : day;
}
