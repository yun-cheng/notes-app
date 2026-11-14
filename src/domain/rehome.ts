import type { Card } from './types';

/** Moves cards from vaults this account doesn't have into `target`. */
export function rehomeCards(cards: Card[], known: Set<string>, target: string): Card[] {
  return cards.map((card) => (known.has(card.vaultId) ? card : { ...card, vaultId: target }));
}
