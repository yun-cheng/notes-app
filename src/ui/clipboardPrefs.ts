import { useSyncExternalStore } from 'react';
import type { CopyStyle } from '../domain/clipboard';

export type { CopyStyle };
/** How text pasted from other apps comes in: as it was formatted, read as Markdown, or as plain words. */
export type PasteStyle = 'rich' | 'markdown' | 'plain';

export interface ClipboardPrefs {
  copy: CopyStyle;
  paste: PasteStyle;
}

export const COPY_STYLES: Record<CopyStyle, string> = { rich: 'Rich text', markdown: 'Markdown', plain: 'Plain text' };
export const PASTE_STYLES: Record<PasteStyle, string> = { rich: 'Keep formatting', markdown: 'Markdown', plain: 'Plain text' };

const KEY = 'notes-app:clipboard';
const DEFAULTS: ClipboardPrefs = { copy: 'rich', paste: 'rich' };

/** Kept on this device only, like the display settings: each computer may paste into different apps. */
function read(): ClipboardPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof ClipboardPrefs, unknown>>;
    return {
      copy: typeof raw.copy === 'string' && raw.copy in COPY_STYLES ? (raw.copy as CopyStyle) : DEFAULTS.copy,
      paste: typeof raw.paste === 'string' && raw.paste in PASTE_STYLES ? (raw.paste as PasteStyle) : DEFAULTS.paste,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = typeof window === 'undefined' ? DEFAULTS : read();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    notify();
  });
}

/** The settings as they are now, for a copy or paste handler that runs long after its editor was made. */
export const clipboardPrefs = () => current;

export function setClipboardPrefs(patch: Partial<ClipboardPrefs>) {
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

export function useClipboardPrefs(): ClipboardPrefs {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULTS);
}
