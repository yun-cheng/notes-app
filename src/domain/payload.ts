import { parseDateKey, toDateKey } from './dates';
import type { CardPayload } from './types';

/**
 * A card as it is now. The diary used to be its own type of card, one per day; now it's a vault of ordinary
 * entries, so a diary card saved back then reads as a note, written on its day (at the end of it, if it was
 * started on another day).
 */
export function modernCard<T extends { type: string }>(card: T): T {
  if (card.type !== 'diary') return card;
  const { date, ...rest } = card as T & { date?: unknown; createdAt?: unknown };
  const onItsDay = typeof date !== 'string' || (typeof rest.createdAt === 'number' && toDateKey(new Date(rest.createdAt)) === date);
  return { ...rest, type: 'note', ...(onItsDay ? {} : { createdAt: parseDateKey(date).setHours(23, 59, 59, 999) }) } as unknown as T;
}

/** Reads a stored card payload, which may be from before the diary was a vault. */
export const parsePayload = (text: string): CardPayload => modernCard(JSON.parse(text) as CardPayload);
