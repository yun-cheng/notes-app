import { displayTitle, isBlank, linkedCardIds, plainText } from './content';
import type { Card, DiaryCard, TagCard, TodoCard } from './types';

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
  /** Date to vault ID, for diary entries in locked vaults. */
  lockedDiaries: Map<string, string>;
  /** Cards shown in lists, search and export. */
  live: Card[];
  tags: TagCard[];
  pinnedTags: TagCard[];
  todos: TodoCard[];
  diaryByDate: Map<string, DiaryCard>;
  trash: Card[];
  backlinks: Map<string, Backlink[]>;
}

const byTitle = (a: Card, b: Card) => a.title.localeCompare(b.title);

/** Cards in `locked` vaults go no further than this function, so no list, search or backlink can show them. */
export function buildIndex(allCards: Card[], locked: ReadonlySet<string> = new Set()): CardIndex {
  const cards: Card[] = [];
  const lockedCards = new Map<string, string>();
  const lockedDiaries = new Map<string, string>();
  for (const card of allCards) {
    if (!locked.has(card.vaultId)) {
      cards.push(card);
      continue;
    }
    lockedCards.set(card.id, card.vaultId);
    if (card.type === 'diary' && !card.deleted && !isBlank(card)) lockedDiaries.set(card.date, card.vaultId);
  }

  const byId = new Map(cards.map((c) => [c.id, c]));
  const live = cards.filter((c) => !c.deleted && !isBlank(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  const backlinks = new Map<string, Backlink[]>();
  const diaryByDate = new Map<string, DiaryCard>();
  const add = (to: string, link: Backlink) => {
    if (to === link.from.id || lockedCards.has(to)) return;
    const list = backlinks.get(to);
    if (list) list.push(link);
    else backlinks.set(to, [link]);
  };

  for (const card of live) {
    card.tags.forEach((to) => add(to, { from: card, kind: 'tag' }));
    linkedCardIds(card.content).forEach((to) => add(to, { from: card, kind: 'link' }));
    if (card.type === 'diary') {
      const seen = diaryByDate.get(card.date);
      if (!seen || seen.updatedAt < card.updatedAt) diaryByDate.set(card.date, card);
    }
  }

  const tags = live.filter((c): c is TagCard => c.type === 'tag').sort(byTitle);
  return {
    byId,
    lockedCards,
    lockedDiaries,
    live,
    tags,
    pinnedTags: tags.filter((t) => t.pinned),
    todos: live.filter((c): c is TodoCard => c.type === 'todo'),
    diaryByDate,
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

/** The title to show for a linked card. A link into a locked vault must not reveal the stored title. */
export function linkTitle(index: CardIndex, id: string, fallback: string): string {
  if (index.lockedCards.has(id)) return 'Locked';
  const target = index.byId.get(id);
  return target && !target.deleted ? displayTitle(target) : fallback;
}

/** A card's text with links shown under their target's current title. */
export function cardText(index: CardIndex, card: Card): string {
  return plainText(card.content, (id, label) => linkTitle(index, id, label));
}
