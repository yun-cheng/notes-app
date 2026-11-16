import type { StreamItem } from './stream';
import { pickInGroup, rankIn, type TagGroup } from './tagGroups';
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
