import { displayTitle, isBlank, linkedCardIds, plainText } from './content';
import type { Card, DiaryCard, TagCard, TodoCard } from './types';

export interface Backlink {
  from: Card;
  kind: 'link' | 'tag';
}

/** Everything here is derived on the device and never synced. */
export interface CardIndex {
  /** Every card, including deleted and blank ones. */
  byId: Map<string, Card>;
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

export function buildIndex(cards: Card[]): CardIndex {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const live = cards.filter((c) => !c.deleted && !isBlank(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  const backlinks = new Map<string, Backlink[]>();
  const diaryByDate = new Map<string, DiaryCard>();
  const add = (to: string, link: Backlink) => {
    if (to === link.from.id) return;
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

/** A card's text with links shown under their target's current title. */
export function cardText(index: CardIndex, card: Card): string {
  return plainText(card.content, (id) => {
    const target = index.byId.get(id);
    return target && !target.deleted ? displayTitle(target) : undefined;
  });
}
