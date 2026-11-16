import type { StreamItem } from './stream';
import { pickInGroup, rankIn, type TagGroup } from './tagGroups';
import { completeTodo } from './todos';
import type { NoteCard, TagCard, TodoCard } from './types';

/**
 * The journal as a board: a tag group's tags as columns, like Status (To do, Doing, Done), each holding the entries
 * with that tag, in an order set by dragging them. Entries with none of the group's tags wait in the first column,
 * "No status". An entry with two tags of a group (a many-choice group, or a clash) shows in the first one's column.
 */
export interface BoardColumn {
  /** The tag's ID, or '' for entries with none of the group's tags. */
  key: string;
  tag?: TagCard;
  items: StreamItem[];
}

type Entry = NoteCard | TodoCard;

/** Space left between positions, so a card can go between two many times before they need spacing out again. */
const STEP = 1024;

/** Where an entry sits in its column: its own place once dragged, otherwise when it was written, so new ones come last. */
export const positionOf = (card: Entry) => (typeof card.position === 'number' && Number.isFinite(card.position) ? card.position : card.createdAt);

const byPosition = (a: StreamItem, b: StreamItem) => positionOf(a.card) - positionOf(b.card) || a.card.createdAt - b.card.createdAt || (a.card.id < b.card.id ? -1 : 1);

/** The columns for a group: "No {group}" first, then its tags in the group's order, each in board order. */
export function boardColumns(items: StreamItem[], group: TagGroup): BoardColumn[] {
  const columns: BoardColumn[] = [{ key: '', items: [] }, ...group.members.map((tag) => ({ key: tag.id, tag, items: [] as StreamItem[] }))];
  for (const item of items) columns[(rankIn(group, item.card.tags) + 1) % columns.length].items.push(item);
  for (const column of columns) column.items.sort(byPosition);
  return columns;
}

/** The column an entry is in. */
export function columnOf(card: Entry, group: TagGroup): string {
  return group.members[rankIn(group, card.tags)]?.id ?? '';
}

/**
 * An entry's tags after moving it from one column to another. In a one-choice group the new column's tag takes the
 * place of the group's; in a many-choice group only the column it left is swapped for the one it went to, so its
 * other tags in the group stay. To "No {group}" takes all of the group's tags off.
 */
export function boardTags(tags: string[], group: TagGroup, from: string, to: string): string[] {
  if (from === to) return tags;
  if (!to) return pickInGroup(tags, group, null);
  if (group.choice === 'one') return pickInGroup(tags, group, to);
  const kept = tags.filter((t) => t !== from);
  return kept.includes(to) ? kept : [...kept, to];
}

/**
 * The positions to save for dropping `moved` at `index` among `others`, a column's entries in order without it:
 * just its own, halfway between its new neighbours, or, when they're too close to fit one between (or level), the
 * whole column spaced out again. Empty when it's already there.
 */
export function placeAt(others: Entry[], index: number, moved: Entry): Map<string, number> {
  const at = Math.max(0, Math.min(index, others.length));
  const before = others[at - 1];
  const after = others[at];
  const low = before && positionOf(before);
  const high = after && positionOf(after);
  const now = positionOf(moved);
  // Already between them, as when dropped back where it was.
  if ((low === undefined || low < now) && (high === undefined || now < high)) return new Map();
  let place: number;
  if (low === undefined && high === undefined) place = now;
  else if (low === undefined) place = high! - STEP;
  else if (high === undefined) place = low + STEP;
  else place = low + (high - low) / 2;
  if ((low === undefined || low < place) && (high === undefined || place < high)) return new Map([[moved.id, place]]);
  // No room: space the column out from where it starts.
  const order = [...others.slice(0, at), moved, ...others.slice(at)];
  const start = positionOf(order[0] === moved ? (others[0] ?? moved) : order[0]);
  const spaced = new Map<string, number>();
  order.forEach((card, i) => {
    const place = start + i * STEP;
    if (card === moved || positionOf(card) !== place) spaced.set(card.id, place);
  });
  return spaced;
}

/**
 * The tag in a one-choice group that stands for a ticked todo: the one named Done. A board by such a group keeps
 * its Done column and todos' boxes in step (`statusForMove`, `tagsForStatus`).
 */
export function doneTagOf(group: TagGroup): TagCard | undefined {
  return group.choice === 'one' ? group.members.find((t) => t.title.trim().toLowerCase() === 'done') : undefined;
}

/** The status a todo takes when dragged from one column to another: done into Done, open again out of it; null for no change. */
export function statusForMove(card: Entry, group: TagGroup, from: string, to: string): 'open' | 'done' | null {
  const done = doneTagOf(group);
  if (card.type !== 'todo' || !done || from === to) return null;
  if (to === done.id && card.status !== 'done') return 'done';
  if (from === done.id && card.status === 'done') return 'open';
  return null;
}

/**
 * A todo's tags after it's ticked or reopened, on each board it's on: ticked, it moves to its group's Done; reopened
 * from Done, to the group's first other tag. Only groups with a Done tag, and only when the todo already has one of
 * the group's tags, so ticking a todo that's on no board tags nothing. The same array when nothing changes.
 */
export function tagsForStatus(tags: string[], groups: TagGroup[], status: 'open' | 'done'): string[] {
  let next = tags;
  for (const group of groups) {
    const done = doneTagOf(group);
    if (!done || !group.members.some((m) => next.includes(m.id))) continue;
    if (status === 'done' && !next.includes(done.id)) next = pickInGroup(next, group, done.id);
    if (status === 'open' && next.includes(done.id)) {
      const back = group.members.find((m) => m.id !== done.id);
      next = back ? pickInGroup(next, group, back.id) : next;
    }
  }
  return next;
}

/** What a move between columns changes on the card, besides its place. */
export interface MovePatch {
  tags?: string[];
  status?: 'open' | 'done';
  due?: string;
  waiting?: boolean;
}

/**
 * What moving a card to another column does, besides its place. `next` is set when a repeating todo was ticked:
 * it moves on to that date instead of being done, and stays in the column it was in. `became` names what it
 * became, for the toast: done, reopened, waiting, no longer waiting, or just moved.
 */
export interface BoardMove {
  patch: MovePatch;
  next?: string;
  became: 'done' | 'open' | 'waiting' | 'resumed' | 'moved';
}

/** Moving a card between a tag group's columns: its tag swapped, and in a Done column ticked or reopened. */
export function groupMove(card: Entry, group: TagGroup, from: string, to: string, today: string): BoardMove {
  const status = statusForMove(card, group, from, to);
  if (status === 'done' && card.type === 'todo' && card.repeat) {
    const { patch, next } = completeTodo(card, today);
    return { patch, next, became: 'done' };
  }
  const tags = boardTags(card.tags, group, from, to);
  const done = card.type === 'todo' && status === 'done' ? completeTodo(card, today).patch : status === 'open' ? { status: 'open' as const } : {};
  return { patch: { ...(tags !== card.tags ? { tags } : {}), ...done }, became: status ?? 'moved' };
}

/**
 * The board by todo state, which needs no tags: its columns are Open, Waiting and Done, from each todo's own box and
 * Waiting mark, so dragging a card ticks it, reopens it or marks it waiting. Notes, which have neither, aren't on it.
 */
export const STATE_BOARD = 'state';
export type TodoState = 'open' | 'waiting' | 'done';
export const TODO_STATES: TodoState[] = ['open', 'waiting', 'done'];
export const TODO_STATE_LABEL: Record<TodoState, string> = { open: 'Open', waiting: 'Waiting', done: 'Done' };

export const stateOf = (todo: TodoCard): TodoState => (todo.status === 'done' ? 'done' : todo.waiting ? 'waiting' : 'open');

/** The todos among the items, in a column for each state, in board order. */
export function stateColumns(items: StreamItem[]): BoardColumn[] {
  const columns = TODO_STATES.map((key) => ({ key, items: [] as StreamItem[] }));
  for (const item of items) if (item.card.type === 'todo') columns[TODO_STATES.indexOf(stateOf(item.card))].items.push(item);
  for (const column of columns) column.items.sort(byPosition);
  return columns;
}

/**
 * Moving a todo between the state columns. Into Done it's ticked (a repeating one moves on to its next date and
 * stays); into Open or Waiting it's reopened, waiting or not. On a board by a group with a Done tag it moves into
 * Done or out of it too, as ticking it does.
 */
export function stateMove(todo: TodoCard, to: TodoState, today: string, groups: TagGroup[]): BoardMove {
  const from = stateOf(todo);
  if (from === to) return { patch: {}, became: 'moved' };
  const retag = (status: 'open' | 'done') => {
    const tags = tagsForStatus(todo.tags, groups, status);
    return tags === todo.tags ? {} : { tags };
  };
  if (to === 'done') {
    const { patch, next } = completeTodo(todo, today);
    return next ? { patch, next, became: 'done' } : { patch: { ...patch, ...retag('done') }, became: 'done' };
  }
  const reopen = from === 'done' ? { status: 'open' as const, ...retag('open') } : {};
  return { patch: { ...reopen, waiting: to === 'waiting' }, became: to === 'waiting' ? 'waiting' : from === 'done' ? 'open' : 'resumed' };
}
