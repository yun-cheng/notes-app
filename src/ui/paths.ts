import type { Location } from 'react-router';
import type { Card } from '../domain/types';

/** Notes and todos open in a sheet, over whatever page they were opened from. */
export const entryPath = (id: string) => `/journal/${id}`;

export const opensInSheet = (card: Card) => card.type === 'note' || card.type === 'todo';

export const cardPath = (card: Card) => (card.type === 'diary' ? `/day/${card.date}` : opensInSheet(card) ? entryPath(card.id) : `/card/${card.id}`);

/** Router state for a link that opens a sheet: the page to keep showing under it. */
export interface SheetState {
  background?: Location;
  /** Just created from the sidebar, so the editor starts focused. */
  fresh?: boolean;
}

/** Keeps the page under an open sheet when one sheet links to another. */
export function sheetState(location: Location, card: Card, extra: Omit<SheetState, 'background'> = {}): SheetState | undefined {
  if (!opensInSheet(card)) return undefined;
  const background = (location.state as SheetState | null)?.background ?? location;
  return { ...extra, background };
}
