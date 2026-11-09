import type { Card } from '../domain/types';

export const cardPath = (card: Card) => (card.type === 'diary' ? `/day/${card.date}` : `/card/${card.id}`);
