import type { Card, JSONNode } from './types';

/** Derived from the date, so two devices can't create two diary entries for one day. */
export const diaryId = (vaultId: string, date: string) => `diary:${vaultId}:${date}`;

function relink(node: JSONNode, renamed: Map<string, string>): JSONNode {
  const target = node.type === 'cardLink' ? renamed.get(String(node.attrs?.id)) : undefined;
  return {
    ...node,
    ...(target ? { attrs: { ...node.attrs, id: target } } : {}),
    ...(node.content ? { content: node.content.map((child) => relink(child, renamed)) } : {}),
  };
}

/**
 * Moves cards from vaults this account doesn't have into `target`. Diary IDs contain
 * the vault, so they change too, and any links pointing at them are rewritten.
 */
export function rehomeCards(cards: Card[], known: Set<string>, target: string): Card[] {
  const renamed = new Map<string, string>();
  const moved = cards.map((card) => {
    if (known.has(card.vaultId)) return card;
    const id = card.type === 'diary' ? diaryId(target, card.date) : card.id;
    if (id !== card.id) renamed.set(card.id, id);
    return { ...card, id, vaultId: target };
  });
  return renamed.size ? moved.map((card) => ({ ...card, content: relink(card.content, renamed) })) : moved;
}
