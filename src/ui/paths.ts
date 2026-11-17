import type { Location } from 'react-router';
import { filterParams, type StreamFilter } from '../domain/stream';
import type { Card } from '../domain/types';

/** Notes and todos open in a sheet, over whatever page they were opened from. */
export const entryPath = (id: string) => `/journal/${id}`;

/** The journal, narrowed by a filter. Archived entries are a page of their own, the Archive, filtered the same way. */
export function journalPath(filter: StreamFilter): string {
  const page = filter.archived ? ARCHIVE_PATH : '/journal';
  const query = filterParams({ ...filter, archived: undefined }).toString();
  return query ? `${page}?${query}` : page;
}

/** Archived entries, put away out of the journal: the journal's page, showing them instead. */
export const ARCHIVE_PATH = '/archive';

/** Entries and tags moved to the Trash, to restore. */
export const TRASH_PATH = '/trash';

/** The journal's Templates filter, where templates are kept, written and filtered like any entry. */
export const TEMPLATES_PATH = '/journal?template=1';

/** The history of changes, narrowed the way the journal is. */
export function historyPath(filter: StreamFilter): string {
  const query = filterParams(filter).toString();
  return query ? `/history?${query}` : '/history';
}

/** The pages showing todos by their dates. */
export type DatedPage = '/calendar' | '/timeline';
export const isDatedPage = (pathname: string): pathname is DatedPage => pathname === '/calendar' || pathname === '/timeline';

/**
 * The calendar or the timeline, narrowed by a filter, with what it keeps of its own in the address (the month, the
 * day picked, where the timeline starts) kept as they are.
 */
export function datedPath(page: DatedPage, filter: StreamFilter, own?: URLSearchParams | Record<string, string>): string {
  const query = datedParams(filter, own).toString();
  return query ? `${page}?${query}` : page;
}

/** The address's query for `datedPath`. */
export function datedParams(filter: StreamFilter, own?: URLSearchParams | Record<string, string>): URLSearchParams {
  const kept = new URLSearchParams(own);
  const params = new URLSearchParams();
  for (const key of ['m', 'd', 'from']) {
    const v = kept.get(key);
    if (v) params.set(key, v);
  }
  for (const [k, v] of filterParams(filter)) params.set(k, v);
  return params;
}

export const opensInSheet = (card: Card) => card.type === 'note' || card.type === 'todo';

export const cardPath = (card: Card) => (opensInSheet(card) ? entryPath(card.id) : `/card/${card.id}`);

/** An entry's own history: every version of it, with restore. */
export const versionsPath = (card: Card) => `/card/${card.id}/history`;

/** Router state for a link that opens a sheet: the page to keep showing under it. */
export interface SheetState {
  background?: Location;
  /** Just created from the sidebar, so the editor starts focused. */
  fresh?: boolean;
  /** Opened with Edit (or Enter), so its text starts focused, ready to type. */
  edit?: boolean;
}

/** Keeps the page under an open sheet when one sheet links to another. */
export function sheetState(location: Location, card: Card, extra: Omit<SheetState, 'background'> = {}): SheetState | undefined {
  if (!opensInSheet(card)) return undefined;
  const background = (location.state as SheetState | null)?.background ?? location;
  return { ...extra, background };
}
