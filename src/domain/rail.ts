import { formatDate, isDateKey, parseDateKey } from './dates';

/**
 * The rail beside a long page of entries, photos or what entries hold, as a photo library has: marks for the years
 * (or months, or groups) down its length, a thumb at where the page is, and a label for the place pointed at or
 * dragged to. Each item has a key, the day it's under (or what else groups it, a tag), and a share of the rail, in the
 * order the page shows them, top to bottom: an equal share, or, spaced by nearness (`railSpacing`), a share that's
 * larger the nearer its year is to the one being read.
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
/**
 * How far down from where it's placed a label reaches (its year or month starts at its top; on a phone it's a pill),
 * and the room a dot keeps from it, so no dot sits on a label's words.
 */
const LABEL_HEIGHT = 16;
const DOT_ROOM = 3;

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

const monthYear = (key: string, locale?: string) => formatDate(parseDateKey(key), { month: 'short', year: 'numeric' }, locale);
const month = (key: string, locale?: string) => formatDate(parseDateKey(key), { month: 'short' }, locale);

/** What the place an item is at is called, pointed at or dragged to: its month on a rail of years, else its own name. */
export function railLabel(key: string, scale: RailScale, name: (key: string) => string, locale?: string): string {
  return scale === 'year' && isDateKey(key) ? monthYear(key, locale) : name(key);
}

/**
 * The marks for a rail `height` pixels tall: a label where each year starts (on a rail of years), each month (of
 * months) or each group, with a dot for each month among years and each day among a month's; `name` names a key
 * that isn't a day. A rail of months or days names the year too where it starts ("Mar 2026"), so the year shows
 * however short the page is. Of two labels too near each other, the one with more of the rail under it is kept (a
 * busy year over a few weeks of the one above it), then dots too near anything kept are left out.
 */
export function railMarks(keys: readonly string[], height: number, name: (key: string) => string, locale?: string, spacing?: RailSpacing | null): RailMark[] {
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
    const at = railAtItem(i, n, spacing);
    if (scale === 'name' || !isDateKey(key)) return void labels.push({ at, label: name(key) });
    const before = day;
    day = key;
    if (scale === 'year') {
      if (before === null || before.slice(0, 4) !== key.slice(0, 4)) labels.push({ at, label: key.slice(0, 4) });
      else if (before.slice(0, 7) !== key.slice(0, 7)) dots.push(at);
    } else if (scale === 'month') {
      if (before === null) labels.push({ at, label: monthYear(key, locale) });
      else if (before.slice(0, 7) !== key.slice(0, 7)) labels.push({ at, label: month(key, locale) });
      else dots.push(at);
    } else if (before === null) {
      labels.push({ at, label: monthYear(key, locale) });
    } else {
      dots.push(at);
    }
  });
  // How much of the rail each label has under it, to the next.
  const room = (i: number) => (labels[i + 1]?.at ?? 1) - labels[i].at;
  const keptAt: number[] = [];
  labels.forEach((mark, i) => {
    const above = keptAt.at(-1);
    if (above === undefined || (mark.at - labels[above].at) * height >= LABEL_GAP) keptAt.push(i);
    // In its place: further from the one before it than it was, so as clear of it.
    else if (room(i) > room(above)) keptAt[keptAt.length - 1] = i;
  });
  const kept = keptAt.map((i) => labels[i]);
  const labelled = kept.map((m) => m.at * height);
  const taken: number[] = [];
  const shown = [...kept];
  for (const at of dots) {
    const y = at * height;
    const clear = labelled.every((l) => y < l - DOT_ROOM || y > l + LABEL_HEIGHT + DOT_ROOM);
    if (clear && taken.every((t) => Math.abs(t - y) >= DOT_GAP)) {
      taken.push(y);
      shown.push({ at, label: null });
    }
  }
  return shown.sort((a, b) => a.at - b.at);
}

/**
 * Where each item starts on a rail spaced other than evenly: `starts[i]` for the item at `i`, from 0, and 1 after the
 * last, `n + 1` in all. None (`null`) is an equal share each.
 */
export type RailSpacing = Float64Array;

/** How the rail is spaced: an equal share for each item, or more for the years nearer the one being read. */
export type RailSpacingChoice = 'entries' | 'near';

/**
 * The rail spaced by nearness: each item counts by how many years it is from `year`, the one being read (1 in it, ½ in
 * the year either side, ⅓ the next, and so on), so the year being read is larger and those far off smaller, and a
 * year with few items still takes little of it; an item with no day goes with the year above it. None on a rail that
 * isn't of years, nor with no year to go by.
 */
export function railSpacing(keys: readonly string[], year: number | null): RailSpacing | null {
  const n = keys.length;
  if (year === null || n < 2 || railScale(keys) !== 'year') return null;
  const years = new Float64Array(n);
  let last = NaN;
  for (let i = 0; i < n; i++) {
    if (keys[i]) last = Number(keys[i].slice(0, 4));
    years[i] = last;
  }
  // Items with no day above any with one go with the first year after them.
  const first = years.find((y) => !Number.isNaN(y)) ?? year;
  for (let i = 0; i < n && Number.isNaN(years[i]); i++) years[i] = first;
  const weight = (y: number) => 1 / (1 + Math.abs(y - year));
  let total = 0;
  for (const y of years) total += weight(y);
  const starts = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) starts[i + 1] = starts[i] + weight(years[i]) / total;
  starts[n] = 1;
  return starts;
}

/** The year of the item at `index`, the year a rail spaced by nearness is spaced around; null when it has no day. */
export function railYear(keys: readonly string[], index: number): number | null {
  for (let i = Math.min(index, keys.length - 1); i >= 0; i--) if (isDateKey(keys[i])) return Number(keys[i].slice(0, 4));
  const next = keys.find(isDateKey);
  return next ? Number(next.slice(0, 4)) : null;
}

/** The place on the rail of a place among the items: `x` items down, part way into one when it isn't whole. */
export function railAtItem(x: number, n: number, spacing?: RailSpacing | null): number {
  if (n <= 0) return 0;
  const at = Math.min(n, Math.max(0, x));
  if (!spacing) return at / n;
  const index = Math.min(n - 1, Math.floor(at));
  return spacing[index] + (at - index) * (spacing[index + 1] - spacing[index]);
}

/** The item a place on the rail (0 at the top, 1 at the foot) falls in, and how far into it. */
export function railItem(at: number, n: number, spacing?: RailSpacing | null): { index: number; into: number } {
  const to = Math.min(1, Math.max(0, at));
  if (spacing && n > 0) {
    // The last item starting at or above it.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (spacing[mid] <= to) lo = mid;
      else hi = mid - 1;
    }
    const size = spacing[lo + 1] - spacing[lo];
    return { index: lo, into: size > 0 ? Math.min(1, Math.max(0, (to - spacing[lo]) / size)) : 0 };
  }
  const exact = to * n;
  const index = Math.min(n - 1, Math.floor(exact));
  return { index, into: Math.min(1, exact - index) };
}

/**
 * Items side by side (photos in a row) share one stretch of the page, from the row's top to the next row's: `first`
 * is the row's first item and `count` how many it holds. How far down that stretch the place `into` the item at
 * `index` is, so a slow drag goes smoothly down a row and the gap and heading under it, never back to its top.
 */
export function intoRow(index: number, into: number, first: number, count: number): number {
  return count > 0 ? Math.min(1, Math.max(0, (index - first + into) / count)) : 0;
}

/** `intoRow`, turned round: the place on a rail of `n` items that's `down` the stretch of a row. */
export function rowRailAt(first: number, count: number, down: number, n: number, spacing?: RailSpacing | null): number {
  return n > 0 ? Math.min(1, railAtItem(first + Math.min(1, Math.max(0, down)) * count, n, spacing)) : 0;
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
