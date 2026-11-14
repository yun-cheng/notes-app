import { buildTagGroups, isTagGroup, type TagGroups } from './tagGroups';
import { displayTitle, isBlank, linkedCardIds, plainText } from './content';
import type { Card, TagCard, TodoCard } from './types';

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
  /** Tags that can be put on entries, by title. Tag groups aren't among them. */
  tags: TagCard[];
  tagGroups: TagGroups;
  pinnedTags: TagCard[];
  todos: TodoCard[];
  trash: Card[];
  backlinks: Map<string, Backlink[]>;
}

const byTitle = (a: Card, b: Card) => a.title.localeCompare(b.title);

/** Cards in `locked` vaults go no further than this function, so no list, search or backlink can show them. */
export function buildIndex(allCards: Card[], locked: ReadonlySet<string> = new Set()): CardIndex {
  const cards: Card[] = [];
  const lockedCards = new Map<string, string>();
  for (const card of allCards) {
    if (locked.has(card.vaultId)) lockedCards.set(card.id, card.vaultId);
    else cards.push(card);
  }

  const byId = new Map(cards.map((c) => [c.id, c]));
  const live = cards.filter((c) => !c.deleted && !isBlank(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  const backlinks = new Map<string, Backlink[]>();
  const add = (to: string, link: Backlink) => {
    if (to === link.from.id || lockedCards.has(to)) return;
    const list = backlinks.get(to);
    if (list) list.push(link);
    else backlinks.set(to, [link]);
  };

  for (const card of live) {
    card.tags.forEach((to) => add(to, { from: card, kind: 'tag' }));
    linkedCardIds(card.content).forEach((to) => add(to, { from: card, kind: 'link' }));
  }

  const tagCards = live.filter((c): c is TagCard => c.type === 'tag').sort(byTitle);
  const tagGroups = buildTagGroups(tagCards);
  const tags = tagCards.filter((t) => !isTagGroup(t));
  return {
    byId,
    lockedCards,
    live,
    tags,
    pinnedTags: tags.filter((t) => t.pinned),
    tagGroups,
    todos: live.filter((c): c is TodoCard => c.type === 'todo'),
    trash: cards.filter((c) => c.deleted && !isBlank(c)).sort((a, b) => b.updatedAt - a.updatedAt),
    backlinks,
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
