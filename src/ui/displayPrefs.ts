import { useSyncExternalStore } from 'react';

/** How a web link in an entry is previewed under it: a card with the page's title, description and image, one line, or not at all. */
export type LinkStyle = 'card' | 'compact' | 'off';
/** How an entry's photos show under it: large, as small thumbnails, or as a count that opens them. */
export type PhotoStyle = 'large' | 'thumbs' | 'off';

export interface DisplayPrefs {
  links: LinkStyle;
  photos: PhotoStyle;
}

export const LINK_STYLES: Record<LinkStyle, string> = { card: 'Cards', compact: 'One line', off: 'Off' };
export const PHOTO_STYLES: Record<PhotoStyle, string> = { large: 'Large', thumbs: 'Thumbnails', off: 'Off' };

const KEY = 'notes-app:display';
const DEFAULTS: DisplayPrefs = { links: 'card', photos: 'thumbs' };

/** Kept on this device only: a phone and a computer may want different looks. Storage can be off; the defaults apply then. */
function read(): DisplayPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof DisplayPrefs, unknown>>;
    return {
      links: typeof raw.links === 'string' && raw.links in LINK_STYLES ? (raw.links as LinkStyle) : DEFAULTS.links,
      photos: typeof raw.photos === 'string' && raw.photos in PHOTO_STYLES ? (raw.photos as PhotoStyle) : DEFAULTS.photos,
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
