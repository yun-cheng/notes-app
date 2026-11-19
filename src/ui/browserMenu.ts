import { useEffect } from 'react';

/** Fields where the browser's menu is the only right-click way to paste, or to fix a misspelt word. */
const TEXT_FIELD = 'textarea, select, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="number"]';

/**
 * No browser menu on a right-click anywhere in the app (since 2026-11-19): its menu is for web pages (Back, Save
 * as, Print, Inspect), not for notes. Where the app has a menu of its own (an entry's bubble, words selected in it,
 * an editor's text, a link) that opens instead, and elsewhere a right-click does nothing. Plain text fields keep
 * the browser's menu, as there it's how to paste with the mouse and fix spelling; Shift with the right-click still
 * gives it anywhere, for saving a photo, say.
 */
export function useNoBrowserMenu() {
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (e.shiftKey || (e.target instanceof Element && e.target.closest(TEXT_FIELD))) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, []);
}
