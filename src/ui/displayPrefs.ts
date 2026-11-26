import { useSyncExternalStore } from 'react';
import type { RailSpacingChoice } from '../domain/rail';
import type { LinkStyle, PhotoStyle, PreviewStyle } from '../domain/types';

export type { LinkStyle, PhotoStyle };

export interface DisplayPrefs {
  links: LinkStyle;
  photos: PhotoStyle;
  /** How the rail beside a long page spaces its years (`railSpacing`). */
  rail: RailSpacingChoice;
}

export const LINK_STYLES: Record<LinkStyle, string> = { card: 'Cards', compact: 'One line', off: 'Off' };
export const PHOTO_STYLES: Record<PhotoStyle, string> = { large: 'Large', thumbs: 'Thumbnails', off: 'Off' };
export const RAIL_SPACINGS: Record<RailSpacingChoice, string> = { entries: 'By entries', near: 'Nearer years larger' };

const KEY = 'notes-app:display';
const DEFAULTS: DisplayPrefs = { links: 'card', photos: 'thumbs', rail: 'entries' };

/** Kept on this device only: a phone and a computer may want different looks. Storage can be off; the defaults apply then. */
function read(): DisplayPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof DisplayPrefs, unknown>>;
    return {
      links: typeof raw.links === 'string' && raw.links in LINK_STYLES ? (raw.links as LinkStyle) : DEFAULTS.links,
      photos: typeof raw.photos === 'string' && raw.photos in PHOTO_STYLES ? (raw.photos as PhotoStyle) : DEFAULTS.photos,
      rail: typeof raw.rail === 'string' && raw.rail in RAIL_SPACINGS ? (raw.rail as RailSpacingChoice) : DEFAULTS.rail,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = typeof window === 'undefined' ? DEFAULTS : read();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  // Another tab changed them.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    notify();
  });
}

export function setDisplayPrefs(patch: Partial<DisplayPrefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Kept for this visit only.
  }
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULTS);
}

/**
 * How one entry's previews show: its own style where it has one, else this device's setting. Values from another
 * app version that this one doesn't know fall back to the setting.
 */
export function previewFor(own: PreviewStyle | undefined, prefs: Pick<DisplayPrefs, 'links' | 'photos'>): Pick<DisplayPrefs, 'links' | 'photos'> {
  const links = own?.links;
  const photos = own?.photos;
  return {
    links: typeof links === 'string' && links in LINK_STYLES ? links : prefs.links,
    photos: typeof photos === 'string' && photos in PHOTO_STYLES ? photos : prefs.photos,
  };
}
