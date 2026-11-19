import { isDateKey, parseDateKey } from './dates';

/**
 * The rail beside a long page of entries, photos or what entries hold, as a photo library has: marks for the years
 * (or months, or groups) down its length, a thumb at where the page is, and a label for the place pointed at or
 * dragged to. Each item has a key, the day it's under (or what else groups it, a tag), and an equal share of the rail,
 * in the order the page shows them, top to bottom.
 */

/** A mark on the rail, a fraction of the way down: a label, or a dot where there's no room or need for one. */
export interface RailMark {
  at: number;
  label: string | null;
}

/** How the items are told apart: by year, by month or by day, when they're all under days; else by what groups them. */
export type RailScale = 'year' | 'month' | 'day' | 'name';

/** The labels' least room between them, and the dots', in pixels. */
const LABEL_GAP = 22;
const DOT_GAP = 9;

export function railScale(keys: readonly string[]): RailScale {
  const years = new Set<string>();
  const months = new Set<string>();
  for (const key of keys) {
    // A day, or none (a todo with no due date), sorted among days.
    if (key === '') continue;
    if (!isDateKey(key)) return 'name';
    years.add(key.slice(0, 4));
    months.add(key.slice(0, 7));
  }
  return years.size > 1 ? 'year' : months.size > 1 ? 'month' : 'day';
}

const monthYear = (key: string, locale?: string) => parseDateKey(key).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
const month = (key: string, locale?: string) => parseDateKey(key).toLocaleDateString(locale, { month: 'short' });

/** What the place an item is at is called, pointed at or dragged to: its month on a rail of years, else its own name. */
export function railLabel(key: string, scale: RailScale, name: (key: string) => string, locale?: string): string {
  return scale === 'year' && isDateKey(key) ? monthYear(key, locale) : name(key);
}

/**
 * The marks for a rail `height` pixels tall: a label where each year starts (on a rail of years), each month (of
 * months) or each group, with a dot for each month among years and each day among a month's; `name` names a key
 * that isn't a day. Labels too near the one above are left out, then dots too near anything kept.
 */
export function railMarks(keys: readonly string[], height: number, name: (key: string) => string, locale?: string): RailMark[] {
  const n = keys.length;
  if (!n || height <= 0) return [];
  const scale = railScale(keys);
  const labels: RailMark[] = [];
  const dots: number[] = [];
  let last: string | null = null;
  // The last day passed, past any stretch with none.
  let day: string | null = null;
  keys.forEach((key, i) => {
    if (key === last) return;
    last = key;
    const at = i / n;
    if (scale === 'name' || !isDateKey(key)) return void labels.push({ at, label: name(key) });
    const before = day;
    day = key;
    if (scale === 'year') {
      if (before === null || before.slice(0, 4) !== key.slice(0, 4)) labels.push({ at, label: key.slice(0, 4) });
      else if (before.slice(0, 7) !== key.slice(0, 7)) dots.push(at);
    } else if (scale === 'month') {
      if (before === null || before.slice(0, 7) !== key.slice(0, 7)) labels.push({ at, label: month(key, locale) });
      else dots.push(at);
    } else {
      dots.push(at);
    }
  });
  const kept: RailMark[] = [];
  for (const mark of labels) {
    const above = kept.at(-1);
    if (!above || (mark.at - above.at) * height >= LABEL_GAP) kept.push(mark);
  }
  const taken = kept.map((m) => m.at * height);
  const shown = [...kept];
  for (const at of dots) {
    const y = at * height;
    if (taken.every((t) => Math.abs(t - y) >= DOT_GAP)) {
      taken.push(y);
      shown.push({ at, label: null });
    }
  }
  return shown.sort((a, b) => a.at - b.at);
}

/** The item a place on the rail (0 at the top, 1 at the foot) falls in, and how far into it. */
export function railItem(at: number, n: number): { index: number; into: number } {
  const exact = Math.min(1, Math.max(0, at)) * n;
  const index = Math.min(n - 1, Math.floor(exact));
  return { index, into: Math.min(1, exact - index) };
}

/**
 * Where the page is, as the rail tells it: the line it reads at runs from the top of what's in view, scrolled to the
 * top, to its foot, scrolled to the end, so the thumb is at either end exactly when the page is. `scrolled` and
 * `scrollable` are the page's, `top` and `height` what's in view between its title bar and anything at its foot.
 */
export function readingLine(scrolled: number, scrollable: number, top: number, height: number): number {
  return top + (scrollable > 0 ? height * Math.min(1, Math.max(0, scrolled / scrollable)) : 0);
}

/** How far to scroll so the reading line meets `y`, a place on the page (from its top): `readingLine`, turned round. */
export function scrollFor(y: number, scrollable: number, top: number, height: number): number {
  if (scrollable <= 0) return 0;
  return Math.min(scrollable, Math.max(0, (y - top) / (1 + height / scrollable)));
}

/**
 * Which entries a long stream draws: `skip` left out at the end it opens at (the bottom in a chat, the top in other
 * orders), then `count`. Most of the time `skip` is 0, and `count` grows as the reader scrolls away; a jump far off
 * from the rail draws a stretch around where it lands instead.
 */
export interface DrawnStretch {
  skip: number;
  count: number;
}

/** The items drawn, as `[from, to)` in the stream's order, top to bottom. */
export function drawnRange(n: number, chat: boolean, { skip, count }: DrawnStretch): { from: number; to: number } {
  const near = Math.min(n, skip);
  const far = Math.min(n, near + count);
  return chat ? { from: n - far, to: n - near } : { from: near, to: far };
}

/** The stretch to draw to show the item at `index`: as it is if it's drawn, else `page` of them around it. */
export function stretchFor(n: number, chat: boolean, drawn: DrawnStretch, index: number, page: number): DrawnStretch {
  const { from, to } = drawnRange(n, chat, drawn);
  if (index >= from && index < to) return drawn;
  // Counted from the end it opens at.
  const place = chat ? n - 1 - index : index;
  const skip = Math.max(0, Math.min(place - Math.floor(page / 2), n - page));
  return { skip, count: page };
}
