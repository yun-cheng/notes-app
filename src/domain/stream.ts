import type { CardIndex } from './cardIndex';
import { addDays, isDateKey, parseDateKey, relativeDay, toDateKey } from './dates';
import type { DiaryCard, NoteCard, TodoCard } from './types';

/**
 * One bubble in the journal stream. `day` is the date it's grouped under: the day it was written, or with other
 * sorts the day it was edited or is due ('' for no due date). `at` orders it within the stream.
 */
export type StreamItem =
  | { kind: 'card'; card: NoteCard | TodoCard | DiaryCard; day: string; at: number }
  | { kind: 'locked-diary'; date: string; vaultId: string; day: string; at: number };

export type EntryType = 'note' | 'todo' | 'diary';
/** For todos: open or done, or open and due by today, after today, or with no date. */
export type TodoStatus = 'open' | 'done' | 'today' | 'upcoming' | 'undated';
/** When it was written: today, the past 7 or 30 days, or one day (a date key). */
export type When = 'today' | 'week' | 'month' | string;

/** Oldest first like a chat (the default), newest first, most recently edited last, or by due date. */
export type StreamSort = 'written' | 'newest' | 'edited' | 'due';

/** What the journal is narrowed to, and how it's ordered. Every field is optional and they combine. */
export interface StreamFilter {
  sort?: StreamSort;
  type?: EntryType;
  status?: TodoStatus;
  when?: When;
  tagId?: string;
  vaultId?: string;
}

const TYPES: EntryType[] = ['note', 'todo', 'diary'];
const STATUSES: TodoStatus[] = ['open', 'done', 'today', 'upcoming', 'undated'];
const WHENS = ['today', 'week', 'month'];
const SORTS: StreamSort[] = ['written', 'newest', 'edited', 'due'];

export function parseFilter(params: URLSearchParams): StreamFilter {
  const pick = <T extends string>(key: string, allowed: readonly string[]) => {
    const v = params.get(key);
    return v && allowed.includes(v) ? (v as T) : undefined;
  };
  const when = params.get('when');
  const sort = pick<StreamSort>('sort', SORTS);
  return {
    sort: sort === 'written' ? undefined : sort,
    type: pick<EntryType>('type', TYPES),
    status: pick<TodoStatus>('status', STATUSES),
    when: when && (WHENS.includes(when) || isDateKey(when)) ? when : undefined,
    tagId: params.get('tag') || undefined,
    vaultId: params.get('vault') || undefined,
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
  return params;
}

export const isFiltered = (f: StreamFilter) => !!(f.type || f.status || f.when || f.tagId || f.vaultId);

/** A todo status only makes sense for todos, so it narrows to them. */
export const effectiveType = (f: StreamFilter): EntryType | undefined => (f.status ? 'todo' : f.type);

/** The first and last day of a `when`, as date keys. */
export function whenRange(when: When, today: string): [string, string] {
  if (when === 'today') return [today, today];
  if (when === 'week') return [addDays(today, -6), today];
  if (when === 'month') return [addDays(today, -29), today];
  return [when, when];
}

export const SORT_LABEL: Record<StreamSort, string> = { written: 'Oldest first', newest: 'Newest first', edited: 'Recently edited', due: 'Due date' };
export const STATUS_LABEL: Record<TodoStatus, string> = { open: 'Open', done: 'Done', today: 'Due today', upcoming: 'Upcoming', undated: 'No date' };
export const TYPE_LABEL: Record<EntryType, string> = { note: 'Notes', todo: 'Todos', diary: 'Diary' };
export const WHEN_LABEL: Record<string, string> = { today: 'Written today', week: 'Past 7 days', month: 'Past 30 days' };

export function whenLabel(when: When, today: string): string {
  return WHEN_LABEL[when] ?? relativeDay(when, today);
}

function matchesStatus(todo: TodoCard, status: TodoStatus, today: string): boolean {
  if (status === 'done') return todo.status === 'done';
  if (todo.status !== 'open') return false;
  if (status === 'today') return todo.due !== null && todo.due <= today;
  if (status === 'upcoming') return todo.due !== null && todo.due > today;
  if (status === 'undated') return todo.due === null;
  return true;
}

/** The end of a day, where a diary entry written on another day goes. */
const endOfDay = (date: string) => parseDateKey(date).setHours(23, 59, 59, 999);

/** When a diary entry sits in the stream: when it was started, if that was on its own day. */
function diaryTime(card: DiaryCard): number {
  return toDateKey(new Date(card.createdAt)) === card.date ? card.createdAt : endOfDay(card.date);
}

/**
 * Notes, todos and diary entries in the order they were written, oldest first, like messages in a chat.
 * Locked diary entries show as placeholders when nothing rules them out; their tags can't be read, so a tag hides them.
 */
export function streamItems(index: CardIndex, filter: StreamFilter = {}, today = toDateKey(new Date())): StreamItem[] {
  const { tagId, vaultId, status } = filter;
  const type = effectiveType(filter);
  const [from, to] = filter.when ? whenRange(filter.when, today) : ['', '9999'];
  const inRange = (day: string) => day >= from && day <= to;
  const keep = (card: NoteCard | TodoCard | DiaryCard, day: string) =>
    (!type || card.type === type) &&
    (!tagId || card.tags.includes(tagId)) &&
    (!vaultId || card.vaultId === vaultId) &&
    (!status || (card.type === 'todo' && matchesStatus(card, status, today))) &&
    inRange(day);

  const items: StreamItem[] = [];
  for (const card of index.live) {
    if (card.type !== 'note' && card.type !== 'todo') continue;
    const day = toDateKey(new Date(card.createdAt));
    if (keep(card, day)) items.push({ kind: 'card', card, day, at: card.createdAt });
  }
  for (const card of index.diaryByDate.values()) {
    if (keep(card, card.date)) items.push({ kind: 'card', card, day: card.date, at: diaryTime(card) });
  }
  if (!tagId && (!type || type === 'diary')) {
    for (const [date, locked] of index.lockedDiaries) {
      if (index.diaryByDate.has(date) || !inRange(date) || (vaultId && vaultId !== locked)) continue;
      items.push({ kind: 'locked-diary', date, vaultId: locked, day: date, at: endOfDay(date) });
    }
  }
  return sortItems(items, filter.sort ?? 'written');
}

function sortItems(items: StreamItem[], sort: StreamSort): StreamItem[] {
  if (sort === 'written') return items.sort((a, b) => a.at - b.at);
  if (sort === 'newest') return items.sort((a, b) => b.at - a.at);
  if (sort === 'edited') {
    // Locked entries can't say when they were edited, so they keep their written time.
    const edited = items.map((i) => (i.kind === 'card' ? { ...i, at: i.card.updatedAt, day: toDateKey(new Date(i.card.updatedAt)) } : i));
    return edited.sort((a, b) => a.at - b.at);
  }
  // By due date, soonest first; anything without one after, oldest written first.
  const due = items.map((i) => ({ ...i, day: i.kind === 'card' && i.card.type === 'todo' ? (i.card.due ?? '') : '' }));
  return due.sort((a, b) => (a.day === b.day ? a.at - b.at : !a.day ? 1 : !b.day ? -1 : a.day < b.day ? -1 : 1));
}
