import type { CardIndex } from './cardIndex';
import { hasPhoto, linkUrls } from './content';
import { addDays, isDateKey, parseDateKey, relativeDay, toDateKey } from './dates';
import { rankIn, type TagGroup } from './tagGroups';
import type { Card, NoteCard, TodoCard } from './types';

/**
 * One bubble in the journal stream. `day` is the date it's grouped under: the day it was written, or with other
 * sorts the day it was edited or is due ('' for no due date). `at` orders it within the stream.
 */
export interface StreamItem {
  card: NoteCard | TodoCard;
  day: string;
  at: number;
}

export type EntryType = 'note' | 'todo';
/**
 * For todos: open or done, or open and due by today, after today, or with no date, or waiting. A waiting todo is
 * open, but left out of the three by date: it's not up to you yet.
 */
export type TodoStatus = 'open' | 'done' | 'today' | 'upcoming' | 'undated' | 'waiting';
/** When it was written: today, the past 7 or 30 days, or one day (a date key). */
/** A preset, one day (a date key), or a range of days written `from..to` (`2026-11-03..2026-11-09`). */
export type When = 'today' | 'week' | 'month' | string;

/** Entries holding something besides text: web links or photos. */
export type Contains = 'link' | 'photo';

/**
 * Oldest first like a chat (the default), newest first, most recently edited last, by due date, or by an ordered
 * tag group (`group:<id>`), like Priority, highest first.
 */
export type StreamSort = 'written' | 'newest' | 'edited' | 'due' | `group:${string}`;
export type BaseSort = Exclude<StreamSort, `group:${string}`>;

/** What the journal is narrowed to, and how it's ordered. Every field is optional and they combine. */
export interface StreamFilter {
  sort?: StreamSort;
  type?: EntryType;
  status?: TodoStatus;
  when?: When;
  tagId?: string;
  vaultId?: string;
  has?: Contains;
  /** Archived entries instead of the rest. The journal leaves them out otherwise. */
  archived?: boolean;
  /**
   * Shown as a board, with a tag group's tags as columns (`board.ts`): the group's ID, or `pick` to choose one.
   * Like the sort, it's how the entries show, not which.
   */
  board?: string;
}

const TYPES: EntryType[] = ['note', 'todo'];
const STATUSES: TodoStatus[] = ['open', 'done', 'today', 'upcoming', 'undated', 'waiting'];
const WHENS = ['today', 'week', 'month'];
const SORTS: BaseSort[] = ['written', 'newest', 'edited', 'due'];
const CONTAINS: Contains[] = ['link', 'photo'];

export function parseFilter(params: URLSearchParams): StreamFilter {
  const pick = <T extends string>(key: string, allowed: readonly string[]) => {
    const v = params.get(key);
    return v && allowed.includes(v) ? (v as T) : undefined;
  };
  const when = params.get('when');
  const rawSort = params.get('sort');
  const sort = rawSort && /^group:./.test(rawSort) ? (rawSort as StreamSort) : pick<StreamSort>('sort', SORTS);
  return {
    sort: sort === 'written' ? undefined : sort,
    type: pick<EntryType>('type', TYPES),
    status: pick<TodoStatus>('status', STATUSES),
    when: when && (WHENS.includes(when) || isDateKey(when) || dayRange(when)) ? when : undefined,
    tagId: params.get('tag') || undefined,
    vaultId: params.get('vault') || undefined,
    has: pick<Contains>('has', CONTAINS),
    archived: params.get('archived') === '1' || undefined,
    board: params.get('board') || undefined,
  };
}

export function filterParams(filter: StreamFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.sort && filter.sort !== 'written') params.set('sort', filter.sort);
  if (filter.type) params.set('type', filter.type);
  if (filter.status) params.set('status', filter.status);
  if (filter.when) params.set('when', filter.when);
  if (filter.tagId) params.set('tag', filter.tagId);
  if (filter.vaultId) params.set('vault', filter.vaultId);
  if (filter.has) params.set('has', filter.has);
  if (filter.archived) params.set('archived', '1');
  if (filter.board) params.set('board', filter.board);
  return params;
}

export const isFiltered = (f: StreamFilter) => !!(f.type || f.status || f.when || f.tagId || f.vaultId || f.has || f.archived);

/** One part of a filter, as a chip names it. */
export type FilterPart = 'type' | 'status' | 'when' | 'tagId' | 'vaultId' | 'has' | 'archived';

/**
 * The parts a filter is made of, in the order they're named, each with the filter that's left without it (same
 * order). A todo status means todos, so it comes with the type Todos: taking the status off leaves Todos, and
 * taking the type off takes the status with it.
 */
export function filterParts(f: StreamFilter): { part: FilterPart; without: StreamFilter }[] {
  const type = effectiveType(f);
  const parts: { part: FilterPart; without: StreamFilter }[] = [];
  if (type) parts.push({ part: 'type', without: { ...f, type: undefined, status: undefined } });
  if (f.status) parts.push({ part: 'status', without: { ...f, type, status: undefined } });
  for (const part of ['when', 'tagId', 'vaultId', 'has', 'archived'] as const) if (f[part]) parts.push({ part, without: { ...f, [part]: undefined } });
  return parts;
}

/** A todo status only makes sense for todos, so it narrows to them. */
export const effectiveType = (f: StreamFilter): EntryType | undefined => (f.status ? 'todo' : f.type);

/** The first and last day of a `from..to` range, or null when it isn't one. */
function dayRange(when: When): [string, string] | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(when);
  return m && isDateKey(m[1]) && isDateKey(m[2]) && m[1] <= m[2] ? [m[1], m[2]] : null;
}

/** The `when` for the days from one to another, in either order: a single day when they're the same. */
export function daysWhen(a: string, b: string): When {
  if (a === b) return a;
  return a < b ? `${a}..${b}` : `${b}..${a}`;
}

/** A length of time the date picker can measure from a picked day: "2 weeks ending Nov 9". */
export type SpanUnit = 'day' | 'week' | 'month' | 'year';
/** Whether the days start on the picked day, end on it, or reach the same length to each side of it. */
export type SpanSide = 'starting' | 'ending' | 'around';
export interface Span {
  count: number;
  unit: SpanUnit;
  side: SpanSide;
}

/** The date `count` units on from `day` (back, when negative): the same date of the month, or the month's last day when it's shorter. */
function moveBy(day: string, count: number, unit: SpanUnit): string {
  if (unit === 'day' || unit === 'week') return addDays(day, count * (unit === 'week' ? 7 : 1));
  const months = count * (unit === 'month' ? 1 : 12);
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(y, m - 1 + months + 1, 0, 12).getDate();
  return toDateKey(new Date(y, m - 1 + months, Math.min(d, last), 12));
}

/**
 * The first and last day of a span from a picked day, both included: a week starting Nov 3 is Nov 3 to 9, a week
 * ending Nov 9 is Nov 3 to 9, and a week either side of Nov 9 is Nov 2 to 16.
 */
export function spanRange(day: string, { count, unit, side }: Span): [string, string] {
  if (side === 'starting') return [day, addDays(moveBy(day, count, unit), -1)];
  if (side === 'ending') return [addDays(moveBy(day, -count, unit), 1), day];
  return [moveBy(day, -count, unit), moveBy(day, count, unit)];
}

/** Starting from the day, unless that would run past today, where nothing is written yet. */
export function spanSide(day: string, count: number, unit: SpanUnit, today: string): SpanSide {
  return spanRange(day, { count, unit, side: 'starting' })[1] > today ? 'ending' : 'starting';
}

/** The first and last day of a `when`, as date keys. */
export function whenRange(when: When, today: string): [string, string] {
  if (when === 'today') return [today, today];
  if (when === 'week') return [addDays(today, -6), today];
  if (when === 'month') return [addDays(today, -29), today];
  return dayRange(when) ?? [when, when];
}

/** "Nov 3 – 9", "Oct 28 – Nov 3", with the year when either end isn't this year. */
function rangeLabel([from, to]: [string, string], today: string, locale?: string): string {
  const year = today.slice(0, 4);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (from.slice(0, 4) !== year || to.slice(0, 4) !== year) opts.year = 'numeric';
  return new Intl.DateTimeFormat(locale, opts).formatRange(parseDateKey(from), parseDateKey(to));
}

export const CONTAINS_LABEL: Record<Contains, string> = { link: 'With links', photo: 'With photos' };
export const SORT_LABEL: Record<BaseSort, string> = { written: 'Oldest first', newest: 'Newest first', edited: 'Recently edited', due: 'Due date' };
export const STATUS_LABEL: Record<TodoStatus, string> = { open: 'Open', done: 'Done', today: 'Due today', upcoming: 'Upcoming', undated: 'No date', waiting: 'Waiting' };
export const TYPE_LABEL: Record<EntryType, string> = { note: 'Notes', todo: 'Todos' };
export const WHEN_LABEL: Record<string, string> = { today: 'Written today', week: 'Past 7 days', month: 'Past 30 days' };

/** The group a sort orders by, if it's a group sort and the group is still there. */
export function sortGroup(sort: StreamSort | undefined, groups: TagGroup[]): TagGroup | undefined {
  return sort?.startsWith('group:') ? groups.find((g) => `group:${g.id}` === sort) : undefined;
}

export function sortLabel(sort: StreamSort, groups: TagGroup[]): string {
  const group = sortGroup(sort, groups);
  if (group) return `By ${group.title.toLowerCase()}`;
  return SORT_LABEL[sort as BaseSort] ?? SORT_LABEL.written;
}

export function whenLabel(when: When, today: string, locale?: string): string {
  if (WHEN_LABEL[when]) return WHEN_LABEL[when];
  const range = dayRange(when);
  return range ? rangeLabel(range, today, locale) : relativeDay(when, today, locale);
}

function matchesStatus(todo: TodoCard, status: TodoStatus, today: string): boolean {
  if (status === 'done') return todo.status === 'done';
  if (todo.status !== 'open') return false;
  if (status === 'open') return true;
  if (status === 'waiting') return !!todo.waiting;
  if (todo.waiting) return false;
  if (status === 'today') return todo.due !== null && todo.due <= today;
  if (status === 'upcoming') return todo.due !== null && todo.due > today;
  if (status === 'undated') return todo.due === null;
  return true;
}

/** The day an entry was written on. */
const entryDay = (card: Card) => toDateKey(new Date(card.createdAt));

/** The vaults each card is shared into besides its own, by card ID. A card shows in those vaults too. */
export type SharedInto = ReadonlyMap<string, readonly string[]>;

/**
 * Whether an entry passes a filter. Tags aren't entries, so none does. The Archived filter keeps archived entries
 * only; without it, archived ones still pass here (their history shows), and the journal leaves them out itself.
 */
export function entryMatcher(filter: StreamFilter, today: string, sharedInto?: SharedInto): (card: Card, day?: string) => boolean {
  const { tagId, vaultId, status, has, archived } = filter;
  const type = effectiveType(filter);
  const [from, to] = filter.when ? whenRange(filter.when, today) : ['', '9999'];
  return (card, day = entryDay(card)) =>
    card.type !== 'tag' &&
    (!type || card.type === type) &&
    (!tagId || card.tags.includes(tagId)) &&
    (!vaultId || card.vaultId === vaultId || !!sharedInto?.get(card.id)?.includes(vaultId)) &&
    (!status || (card.type === 'todo' && matchesStatus(card, status, today))) &&
    (!has || (has === 'link' ? linkUrls(card.content).length > 0 : hasPhoto(card.content))) &&
    (!archived || !!card.archived) &&
    day >= from &&
    day <= to;
}

/** Notes and todos in the order they were written, oldest first, like messages in a chat. Archived ones only with the Archived filter. */
export function streamItems(index: CardIndex, filter: StreamFilter = {}, today = toDateKey(new Date()), sharedInto?: SharedInto): StreamItem[] {
  const keep = entryMatcher(filter, today, sharedInto);
  const items: StreamItem[] = [];
  for (const card of index.live) {
    // Templates are only on their own page.
    if ((card.type !== 'note' && card.type !== 'todo') || !!card.archived !== !!filter.archived || card.template) continue;
    const day = entryDay(card);
    if (keep(card, day)) items.push({ card, day, at: card.createdAt });
  }
  const group = sortGroup(filter.sort, index.tagGroups.groups);
  if (group) return sortByGroup(items, group);
  // A sort by a group that's gone falls back to the usual order.
  const sort = filter.sort && filter.sort in SORT_LABEL ? (filter.sort as BaseSort) : 'written';
  return sortItems(items, sort);
}

/** Highest in the group first, each of its tags under its own heading (`day` is the tag's ID), then entries with none. */
function sortByGroup(items: StreamItem[], group: TagGroup): StreamItem[] {
  const ranked = items.map((i) => {
    const rank = rankIn(group, i.card.tags);
    return { item: { ...i, day: group.members[rank]?.id ?? '' }, rank };
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.item.at - b.item.at).map((r) => r.item);
}

function sortItems(items: StreamItem[], sort: BaseSort): StreamItem[] {
  if (sort === 'written') return items.sort((a, b) => a.at - b.at);
  if (sort === 'newest') return items.sort((a, b) => b.at - a.at);
  if (sort === 'edited') {
    const edited = items.map((i) => ({ ...i, at: i.card.updatedAt, day: toDateKey(new Date(i.card.updatedAt)) }));
    return edited.sort((a, b) => a.at - b.at);
  }
  // By due date, soonest first, and on a day by time, with todos due any time that day after the timed ones;
  // anything without a due date after, oldest written first.
  const time = (i: StreamItem) => (i.card.type === 'todo' && i.card.dueTime) || '24:00';
  const due = items.map((i) => ({ ...i, day: i.card.type === 'todo' ? (i.card.due ?? '') : '' }));
  const order = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return due.sort((a, b) => (a.day === b.day ? order(time(a), time(b)) || a.at - b.at : !a.day ? 1 : !b.day ? -1 : order(a.day, b.day)));
}
