import { buildTagGroups, isTagGroup, type TagGroups } from './tagGroups';
import { cardPages, displayTitle, isBlank, linkedCardIds, plainText } from './content';
import type { Card, NoteCard, TagCard, TodoCard } from './types';

export interface Backlink {
  from: Card;
  kind: 'link' | 'tag';
}

/** Everything here is derived on the device and never synced. */
export interface CardIndex {
  /** Every card the user can currently see, including deleted and blank ones. */
  byId: Map<string, Card>;
  /** Card ID to vault ID, for cards in locked vaults. Nothing else about them is exposed here. */
  lockedCards: Map<string, string>;
  /** Cards shown in lists, search and export. */
  live: Card[];
  /** Live notes and todos in creation order (oldest first), so the default journal doesn't re-sort on every edit. */
  entriesByCreated: (NoteCard | TodoCard)[];
  /** Count of live archived non-template notes and todos, for the sidebar's Archive badge. */
  archivedCount: number;
  /** Tags that can be put on entries, by title. Tag groups aren't among them. */
  tags: TagCard[];
  tagGroups: TagGroups;
  pinnedTags: TagCard[];
  /** Live todos, archived ones left out. */
  todos: TodoCard[];
  trash: Card[];
  backlinks: Map<string, Backlink[]>;
}

const byTitle = (a: Card, b: Card) => a.title.localeCompare(b.title);
const isEntry = (c: Card): c is NoteCard | TodoCard => c.type === 'note' || c.type === 'todo';
const isArchivedEntry = (c: Card): boolean => !c.deleted && !blank(c) && isEntry(c) && !!c.archived && !c.template;
const isActiveTodo = (c: Card): c is TodoCard => !c.deleted && !blank(c) && c.type === 'todo' && !c.archived && !c.template;

// What the index works out from each card's documents, kept per card object: cards are never changed in place, and
// an unchanged card keeps its object between reads (CardsContext), so rebuilding after one edit walks one document,
// not every one.
const blankOf = new WeakMap<Card, boolean>();
const linksOf = new WeakMap<Card, string[]>();

function blank(card: Card): boolean {
  let known = blankOf.get(card);
  if (known === undefined) blankOf.set(card, (known = isBlank(card)));
  return known;
}

function links(card: Card): string[] {
  let known = linksOf.get(card);
  // A link on a page behind a card's front counts as much as one on its front.
  if (!known) linksOf.set(card, (known = [...new Set([card.content, ...cardPages(card)].flatMap((doc) => linkedCardIds(doc)))]));
  return known;
}

/** Cards in `locked` vaults go no further than this function, so no list, search or backlink can show them. */
export function buildIndex(allCards: readonly Card[], locked: ReadonlySet<string> = new Set()): CardIndex {
  const cards: Card[] = [];
  const lockedCards = new Map<string, string>();
  const byId = new Map<string, Card>();
  const live: Card[] = [];
  const trash: Card[] = [];
  for (const card of allCards) {
    if (locked.has(card.vaultId)) {
      lockedCards.set(card.id, card.vaultId);
    } else {
      cards.push(card);
      byId.set(card.id, card);
      if (!blank(card)) {
        if (card.deleted) trash.push(card);
        else live.push(card);
      }
    }
  }

  live.sort((a, b) => b.updatedAt - a.updatedAt);
  trash.sort((a, b) => b.updatedAt - a.updatedAt);

  const backlinks = new Map<string, Backlink[]>();
  const add = (to: string, link: Backlink) => {
    if (to === link.from.id || lockedCards.has(to)) return;
    const list = backlinks.get(to);
    if (list) list.push(link);
    else backlinks.set(to, [link]);
  };

  const entriesByCreated: (NoteCard | TodoCard)[] = [];
  const tagCards: TagCard[] = [];
  const todos: TodoCard[] = [];
  let archivedCount = 0;

  for (const card of live) {
    for (const to of card.tags) add(to, { from: card, kind: 'tag' });
    for (const to of links(card)) add(to, { from: card, kind: 'link' });
    if (card.type === 'tag') tagCards.push(card);
    else {
      entriesByCreated.push(card);
      if (card.archived && !card.template) archivedCount++;
      if (card.type === 'todo' && !card.archived && !card.template) todos.push(card);
    }
  }

  entriesByCreated.sort((a, b) => a.createdAt - b.createdAt);
  tagCards.sort(byTitle);
  const tagGroups = buildTagGroups(tagCards);
  const tags = tagCards.filter((t) => !isTagGroup(t));
  return {
    byId,
    lockedCards,
    live,
    entriesByCreated,
    archivedCount,
    tags,
    pinnedTags: tags.filter((t) => t.pinned),
    tagGroups,
    todos,
    trash,
    backlinks,
  };
}

/** Inserts `card` into an array sorted descending by `updatedAt`, checking the front first (the common case for edits). */
function insertUpdatedDesc<T extends Card>(list: T[], card: T): void {
  if (list.length === 0 || card.updatedAt >= list[0].updatedAt) {
    list.unshift(card);
    return;
  }
  let lo = 1;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].updatedAt >= card.updatedAt) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, card);
}

/** Inserts `card` into an array sorted ascending by `createdAt`, checking the end first (the common case for new notes). */
function insertCreatedAsc<T extends NoteCard | TodoCard>(list: T[], card: T): void {
  if (list.length === 0 || card.createdAt >= list[list.length - 1].createdAt) {
    list.push(card);
    return;
  }
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].createdAt <= card.createdAt) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, card);
}

/**
 * Updates `prev` incrementally when only a small set of cards changed and the locked vaults didn't change, avoiding a
 * full 10,000-card re-sort and backlink rebuild on every edit. Falls back to `buildIndex` on bulk changes.
 */
export function updateIndex(prev: CardIndex, prevCards: readonly Card[], nextCards: readonly Card[], locked: ReadonlySet<string>): CardIndex {
  // Find changed, added and removed cards in O(N) pointer comparison (both arrays are ID-sorted).
  const changed: { old?: Card; next?: Card }[] = [];
  let i = 0;
  let j = 0;
  while (i < prevCards.length && j < nextCards.length) {
    const a = prevCards[i];
    const b = nextCards[j];
    if (a === b) {
      i++;
      j++;
    } else if (a.id === b.id) {
      changed.push({ old: a, next: b });
      i++;
      j++;
    } else if (a.id < b.id) {
      changed.push({ old: a });
      i++;
    } else {
      changed.push({ next: b });
      j++;
    }
    if (changed.length > 32) return buildIndex(nextCards, locked);
  }
  while (i < prevCards.length) {
    changed.push({ old: prevCards[i++] });
    if (changed.length > 32) return buildIndex(nextCards, locked);
  }
  while (j < nextCards.length) {
    changed.push({ next: nextCards[j++] });
    if (changed.length > 32) return buildIndex(nextCards, locked);
  }
  if (!changed.length) return prev;

  // If any card crossed into or out of a locked vault, backlink visibility to that card changes: rebuild cleanly.
  for (const d of changed) {
    const wasLocked = !!d.old && locked.has(d.old.vaultId);
    const nowLocked = !!d.next && locked.has(d.next.vaultId);
    if (wasLocked || nowLocked) return buildIndex(nextCards, locked);
  }

  const byId = new Map(prev.byId);
  const live = prev.live.slice();
  const entriesByCreated = prev.entriesByCreated.slice();
  const todos = prev.todos.slice();
  const trash = prev.trash.slice();
  let backlinks: Map<string, Backlink[]> | null = null;
  const ensureBacklinks = () => (backlinks ??= new Map(prev.backlinks));
  let archivedCount = prev.archivedCount;
  let tagsChanged = false;

  const removeBacklinksOf = (card: Card) => {
    const targets = new Set([...card.tags, ...links(card)]);
    for (const to of targets) {
      const map = ensureBacklinks();
      const existing = map.get(to);
      if (!existing) continue;
      const kept = existing.filter((l) => l.from.id !== card.id);
      if (kept.length) map.set(to, kept);
      else map.delete(to);
    }
  };
  const addBacklinksOf = (card: Card) => {
    const addOne = (to: string, kind: 'tag' | 'link') => {
      if (to === card.id || prev.lockedCards.has(to)) return;
      const map = ensureBacklinks();
      const existing = map.get(to);
      map.set(to, existing ? [...existing, { from: card, kind }] : [{ from: card, kind }]);
    };
    for (const to of card.tags) addOne(to, 'tag');
    for (const to of links(card)) addOne(to, 'link');
  };

  for (const { old, next } of changed) {
    const id = (next ?? old)!.id;
    if (next) byId.set(id, next);
    else byId.delete(id);

    const wasLive = !!old && !old.deleted && !blank(old);
    const nowLive = !!next && !next.deleted && !blank(next);
    const wasTrash = !!old && old.deleted && !blank(old);
    const nowTrash = !!next && next.deleted && !blank(next);

    if (old?.type === 'tag' || next?.type === 'tag') tagsChanged = true;
    if (old && isArchivedEntry(old)) archivedCount--;
    if (next && isArchivedEntry(next)) archivedCount++;

    // Update live (updatedAt DESC)
    if (wasLive && nowLive && old!.updatedAt === next!.updatedAt) {
      const idx = live.findIndex((c) => c.id === id);
      if (idx >= 0) live[idx] = next!;
    } else {
      if (wasLive) {
        const idx = live.findIndex((c) => c.id === id);
        if (idx >= 0) live.splice(idx, 1);
      }
      if (nowLive) insertUpdatedDesc(live, next!);
    }

    // Update entriesByCreated (createdAt ASC) — in-place replace for the 99.9% case where createdAt didn't change!
    const wasEntry = wasLive && isEntry(old!);
    const nowEntry = nowLive && isEntry(next!);
    if (wasEntry && nowEntry && old!.createdAt === next!.createdAt) {
      const idx = entriesByCreated.findIndex((c) => c.id === id);
      if (idx >= 0) entriesByCreated[idx] = next!;
    } else {
      if (wasEntry) {
        const idx = entriesByCreated.findIndex((c) => c.id === id);
        if (idx >= 0) entriesByCreated.splice(idx, 1);
      }
      if (nowEntry) insertCreatedAsc(entriesByCreated, next!);
    }

    // Update todos (updatedAt DESC)
    const wasTodo = !!old && isActiveTodo(old);
    const nowTodo = !!next && isActiveTodo(next);
    if (wasTodo && nowTodo && old!.updatedAt === next!.updatedAt) {
      const idx = todos.findIndex((c) => c.id === id);
      if (idx >= 0) todos[idx] = next!;
    } else {
      if (wasTodo) {
        const idx = todos.findIndex((c) => c.id === id);
        if (idx >= 0) todos.splice(idx, 1);
      }
      if (nowTodo) insertUpdatedDesc(todos, next!);
    }

    // Update trash (updatedAt DESC)
    if (wasTrash && nowTrash && old!.updatedAt === next!.updatedAt) {
      const idx = trash.findIndex((c) => c.id === id);
      if (idx >= 0) trash[idx] = next!;
    } else {
      if (wasTrash) {
        const idx = trash.findIndex((c) => c.id === id);
        if (idx >= 0) trash.splice(idx, 1);
      }
      if (nowTrash) insertUpdatedDesc(trash, next!);
    }

    // Update backlinks only for the targets this card touched
    if (wasLive) removeBacklinksOf(old!);
    if (nowLive) addBacklinksOf(next!);
  }

  let tags = prev.tags;
  let tagGroups = prev.tagGroups;
  let pinnedTags = prev.pinnedTags;
  if (tagsChanged) {
    const tagCards = live.filter((c): c is TagCard => c.type === 'tag').sort(byTitle);
    tagGroups = buildTagGroups(tagCards);
    tags = tagCards.filter((t) => !isTagGroup(t));
    pinnedTags = tags.filter((t) => t.pinned);
  }

  return {
    byId,
    lockedCards: prev.lockedCards,
    live,
    entriesByCreated,
    archivedCount,
    tags,
    pinnedTags,
    tagGroups,
    todos,
    trash,
    backlinks: backlinks ?? prev.backlinks,
  };
}

/** The ID in `card.tags`, resolved to live tag cards only. */
export function resolveTags(index: CardIndex, tagIds: string[]): TagCard[] {
  return tagIds
    .map((id) => index.byId.get(id))
    .filter((c): c is TagCard => !!c && c.type === 'tag' && !c.deleted);
}

/**
 * The title to show for a linked card. A link must not reveal its stored title when the target is in
 * a locked vault, or isn't shared with this account at all. A deleted card keeps its stored title.
 */
export function linkTitle(index: CardIndex, id: string, fallback: string): string {
  if (index.lockedCards.has(id)) return 'Locked';
  const target = index.byId.get(id);
  if (!target) return 'Not shared';
  return target.deleted ? fallback : displayTitle(target);
}

/** A card's text with links shown under their target's current title. */
export function cardText(index: CardIndex, card: Card): string {
  return plainText(card.content, (id, label) => linkTitle(index, id, label));
}

/** The text on the pages behind a card's front, the same way, or '' when it has none. */
export function pagesText(index: CardIndex, card: Card): string {
  return cardPages(card)
    .map((page) => plainText(page, (id, label) => linkTitle(index, id, label)))
    .join(' ');
}
