import { displayTitle } from './content';
import { effectiveType, entryMatcher, type StreamFilter } from './stream';
import type { Card, CardRecord } from './types';

/**
 * One change this device made to a card, as the change log stores it: the card's record before and after.
 * Records keep their payload as stored, so a change to a card in an encrypted vault is encrypted here too.
 */
export interface ChangeEntry {
  /** Its place in the log, given when it's first stored. */
  n?: number;
  /** When the change was made, and when it last grew: typing saves a minute apart are one change. */
  at: number;
  until: number;
  /** Changes made by one action, like trashing five entries, share this and are undone together. */
  group: string;
  cardId: string;
  /** Null when the change made the card. */
  before: CardRecord | null;
  /**
   * Set when the change moved the card to another vault: the vault it came from. `before` is then stored the way
   * its new vault stores cards, so moving an entry into an encrypted vault leaves no readable copy here.
   */
  beforeVault?: string;
  after: CardRecord;
  /** The fields that differ between `before` and `after`. Empty for a new card. */
  fields: string[];
  /** Whether saves that follow may join this change. Only typing does that. */
  joins?: boolean;
  /** Set while the change is undone, to when that happened. */
  undoneAt?: number;
}

/** A change with its cards readable. `sealed` when they aren't, because their vault's key isn't open. */
export interface Change {
  n: number;
  at: number;
  until: number;
  group: string;
  cardId: string;
  before: Card | null;
  after: Card;
  fields: string[];
  undoneAt?: number;
  sealed: boolean;
}

/** Not part of what a card says: who it is, and bookkeeping every save touches. */
const BOOKKEEPING = new Set(['id', 'updatedAt', 'seq']);
const TEXT = new Set(['title', 'content']);

const value = (card: Card, key: string): unknown => (card as unknown as Record<string, unknown>)[key];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields two versions of a card differ in, sorted. A field one of them lacks counts. */
export function changedFields(before: Card, after: Card): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !BOOKKEEPING.has(key) && !same(value(before, key), value(after, key))).sort();
}

/** Whether a change touched nothing but the words. */
export const isTextChange = (fields: string[]) => fields.length > 0 && fields.every((f) => TEXT.has(f));

/** A few words for what a change did. */
export function describeChange({ before, after, fields }: Pick<Change, 'before' | 'after' | 'fields'>): string {
  if (!before) return 'Created';
  const has = (key: string) => fields.includes(key);
  if (has('deleted')) return after.deleted ? 'Moved to Trash' : 'Restored from Trash';
  if (has('type')) return after.type === 'todo' ? 'Turned into a todo' : 'Turned into a note';
  if (has('vaultId')) return 'Moved to another vault';
  if (has('status') && after.type === 'todo') return after.status === 'done' ? 'Marked done' : 'Reopened';
  if (has('content')) return 'Edited';
  if (has('title')) return after.type === 'todo' ? 'Edited' : 'Renamed';
  if (has('tags')) return 'Changed tags';
  if (has('due') || has('dueTime')) return 'Changed due date';
  if (has('repeat')) return 'Changed repeat';
  if (has('pinned') && after.type === 'tag') return after.pinned ? 'Pinned' : 'Unpinned';
  if (has('color')) return 'Changed color';
  if (has('preview')) return 'Changed style';
  if (has('members') || has('choice') || has('ordered')) return 'Changed tag group';
  return 'Changed';
}

/** What to call the card a change was made to: its newest readable name. */
export function changeTitle(change: Change, current?: Card): string {
  if (change.sealed) return 'Locked entry';
  return displayTitle(current ?? change.after);
}

/**
 * A change as it may be shown while some vaults are locked: unreadable when its card is in one of them, or was
 * before the change. A vault from before encryption can be locked with its cards still readable in the database.
 */
export function sealLocked(change: Change, locked: ReadonlySet<string>): Change {
  if (change.sealed) return change;
  const shut = locked.has(change.after.vaultId) || (!!change.before && locked.has(change.before.vaultId));
  return shut ? { ...change, sealed: true } : change;
}

/**
 * A change can be undone while the card still holds what the change left: every field it set is as it set it.
 * So an edit made since, here or on another device, is never overwritten; undo that one first. A new card can
 * be undone until it's in the Trash, which is where undoing it puts it.
 */
export function canUndo(change: Change, current: Card | undefined): boolean {
  if (change.undoneAt !== undefined || change.sealed || !current) return false;
  if (!change.before) return !current.deleted;
  return change.fields.every((key) => same(value(current, key), value(change.after, key)));
}

/** An undone change can be redone while the card still holds what undoing left. */
export function canRedo(change: Change, current: Card | undefined): boolean {
  if (change.undoneAt === undefined || change.sealed || !current) return false;
  if (!change.before) return current.deleted;
  const before = change.before;
  return change.fields.every((key) => same(value(current, key), value(before, key)));
}

/**
 * The card with a change taken back, or put back. Only the fields the change touched move, so everything else
 * the card has gained since stays. Undoing a new card moves it to the Trash.
 */
export function revertCard(current: Card, change: Change, direction: 'undo' | 'redo'): Card {
  if (!change.before) return { ...current, deleted: direction === 'undo' };
  const source = direction === 'undo' ? change.before : change.after;
  const next = { ...current } as unknown as Record<string, unknown>;
  for (const key of change.fields) {
    if (key in source) next[key] = value(source, key);
    else delete next[key];
  }
  return next as unknown as Card;
}

/**
 * Whether a change belongs in a filtered history: the card passed the filter before the change or after it.
 * Ticking a todo while looking at open todos is part of their history, though the todo is no longer among them.
 */
export function matchesChange(change: Change, filter: StreamFilter, today: string): boolean {
  const inVault = (card: Card) => !filter.vaultId || card.vaultId === filter.vaultId;
  const narrowed = !!(effectiveType(filter) || filter.has || filter.when);
  // Nothing but its vault is known about a card that can't be read.
  if (change.sealed) return !narrowed && !filter.tagId && inVault(change.after);
  const match = entryMatcher(filter, today);
  const fits = (card: Card | null) => {
    if (!card) return false;
    // Tags aren't entries: they show when nothing narrows the entries, or when it's their own filter.
    if (card.type === 'tag') return !narrowed && inVault(card) && (!filter.tagId || filter.tagId === card.id);
    return match(card);
  };
  return fits(change.before) || fits(change.after);
}

/** Changes made by one action. */
export interface ChangeGroup {
  group: string;
  /** Newest first. */
  changes: Change[];
  /** When the newest of them was made. */
  at: number;
}

/** Changes gathered by action, newest action first. */
export function groupChanges(changes: Change[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const change of [...changes].sort((a, b) => b.n - a.n)) {
    const group = groups.get(change.group);
    if (group) group.changes.push(change);
    else groups.set(change.group, { group: change.group, changes: [change], at: change.until });
  }
  return [...groups.values()];
}

/**
 * What Undo takes back: the newest action with anything that can be undone. `usable` says which changes can,
 * so one blocked by a later edit or sitting in a locked vault is passed over, not in the way.
 */
export function nextUndo(changes: Change[], usable: (change: Change) => boolean): Change[] {
  for (const group of groupChanges(changes)) {
    const ready = group.changes.filter((c) => c.undoneAt === undefined && usable(c));
    if (ready.length) return ready;
  }
  return [];
}

/**
 * What Redo puts back: the changes undone last, together. Nothing once a change was made after that undo,
 * as in any editor; such a change can still be redone on its own from the history.
 */
export function nextRedo(changes: Change[], usable: (change: Change) => boolean): Change[] {
  let last = -Infinity;
  for (const change of changes) if (change.undoneAt !== undefined && change.undoneAt > last) last = change.undoneAt;
  if (changes.some((c) => c.undoneAt === undefined && c.until > last)) return [];
  return changes.filter((c) => c.undoneAt === last && usable(c));
}
