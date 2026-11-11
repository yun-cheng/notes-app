import type { Card } from '../domain/types';

/** Notes open in a sheet over the notes stream. */
export const notePath = (id: string) => `/notes/${id}`;

export const cardPath = (card: Card) => (card.type === 'diary' ? `/day/${card.date}` : card.type === 'note' ? notePath(card.id) : `/card/${card.id}`);
