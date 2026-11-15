import { useCallback, useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { permissions, type Permissions } from '../domain/access';
import type { Card } from '../domain/types';
import { useCards } from '../state/CardsContext';

const KEY = 'notes-app:view-only';

/** Kept on this device only, like the display settings. Storage can be off; then it's off. */
function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let current = typeof window === 'undefined' ? false : read();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  // Another tab turned it on or off.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    notify();
  });
}

export function setViewOnly(on: boolean) {
  current = on;
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** View only: entries can be read, searched, filtered and copied, but nothing can be written, changed or undone. */
export function useViewOnly(): boolean {
  return useSyncExternalStore(subscribe, () => current, () => false);
}

const READ_ONLY = { edit: false, comment: false, manage: false, share: false, protect: false } as const;

/** What this account may do with a card: nothing that changes it while view only is on. */
export function usePermissions(): (card: Card) => Permissions {
  const { vaults, shared } = useCards();
  const viewOnly = useViewOnly();
  return useCallback(
    (card: Card) => {
      const can = permissions(card, vaults, shared);
      return viewOnly ? { ...can, ...READ_ONLY } : can;
    },
    [vaults, shared, viewOnly],
  );
}

/** Said when something would make a change while view only is on. */
export const VIEW_ONLY_NOTE = 'View only is on. Turn it off in the top bar to make changes.';

/** The top bar's switch: an eye, named "View only" while it's on. */
export function ViewOnlyToggle() {
  const on = useViewOnly();
  return (
    <button
      type="button"
      className={`view-only-toggle${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label="View only"
      title={on ? 'View only: nothing can be changed. Press to make changes again' : 'View only: read without changing anything'}
      onClick={() => setViewOnly(!on)}
    >
      <Icon name="eye" size={16} />
      {on && <span>View only</span>}
    </button>
  );
}
