import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useCardsSelect } from '../state/CardsContext';
import { RAIL_AT } from './ScrollRail';

/**
 * Where each page was scrolled to, kept while the app is open, so going back to a page (or to a view of the journal,
 * a tag or a vault) finds it where it was left, as a chat app keeps each chat's place. A reload opens each as new.
 * Each account's are its own: keys start with its ID.
 *
 * A list drawn some at a time (the journal, the Trash, Links, Files) keeps the item at the top of the screen and how
 * far down it was, since what's drawn is different when it opens again; other pages keep how far down they were.
 */
export interface ItemPlace {
  id: string;
  top: number;
}

const items = new Map<string, ItemPlace>();
const pixels = new Map<string, number>();

/** The place kept for a list by `key`, if any. */
export const placeOf = (key: string) => items.get(key);

/**
 * Keeps where the list in `root` is scrolled to: the first of its items not above the screen, by `idAt` (an item's
 * ID from its place among them all). At the end it opens at (the newest, at the foot, for `chat`), nothing is kept,
 * so it opens there again, with whatever was written meanwhile.
 */
export function keepPlace(key: string, root: HTMLElement, idAt: (at: number) => string | undefined, chat: boolean) {
  const doc = document.documentElement;
  const atEnd = chat ? doc.scrollHeight - window.scrollY - window.innerHeight < 40 : window.scrollY < 4;
  let place: ItemPlace | undefined;
  if (!atEnd) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${RAIL_AT}]`)) {
      const box = el.getBoundingClientRect();
      if (box.bottom <= 0) continue;
      const id = idAt(Number(el.getAttribute(RAIL_AT)));
      if (id) place = { id, top: box.top };
      break;
    }
  }
  if (place) items.set(key, place);
  else items.delete(key);
}

/** How long an item gone back to is held where it was, while what's around it loads and changes its height. */
const HOLD_MS = 1500;
const INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Scrolls so the item at `at` in `root` is as far down the screen as it was; false when it isn't drawn. For a moment
 * after, it's kept there as what's above it grows or shrinks (a link's preview, a photo, more drawn above, the title
 * bar's filters), unless the reader scrolls first.
 */
export function goToPlace(root: HTMLElement, at: number, top: number): boolean {
  const align = () => {
    const el = root.isConnected && root.querySelector<HTMLElement>(`[${RAIL_AT}="${at}"]`);
    if (!el) return false;
    const by = el.getBoundingClientRect().top - top;
    if (Math.abs(by) >= 1) window.scrollTo({ top: window.scrollY + by, behavior: 'instant' });
    return true;
  };
  if (!align()) return false;
  const watch = new ResizeObserver(() => align() || stop());
  const later = setTimeout(stop, HOLD_MS);
  function stop() {
    watch.disconnect();
    clearTimeout(later);
    for (const e of INPUT) window.removeEventListener(e, stop);
  }
  // The page too: what's above the list (the title bar's filters) can change its height and move it.
  watch.observe(root);
  watch.observe(document.body);
  for (const e of INPUT) window.addEventListener(e, stop, { passive: true });
  return true;
}

/**
 * Scrolls to `y` once the page is tall enough to (a page laid out after it shows, as Photos, grows a moment later),
 * giving up after a while or when the reader scrolls first. Returns how to stop waiting.
 */
function scrollWhenTall(y: number, done: () => void): () => void {
  const doc = document.documentElement;
  const go = () => {
    if (y > 0 && doc.scrollHeight - window.innerHeight < y - 1) return false;
    window.scrollTo({ top: y, behavior: 'instant' });
    return true;
  };
  if (go()) {
    done();
    return () => {};
  }
  const watch = new ResizeObserver(() => go() && stop());
  const later = setTimeout(() => (go(), stop()), HOLD_MS);
  function stop() {
    watch.disconnect();
    clearTimeout(later);
    for (const e of INPUT) window.removeEventListener(e, stop);
    done();
  }
  watch.observe(document.body);
  for (const e of INPUT) window.addEventListener(e, stop, { passive: true });
  return stop;
}

/**
 * For a page (`Page`) with no list of its own to keep its place (`own`): opens it where it was left by its address,
 * or at the top, rather than wherever the page before was scrolled to.
 */
export function usePagePlace(own: boolean) {
  const { pathname, search } = useLocation();
  const key = `${useCardsSelect((c) => c.accountId)} ${pathname}${search}`;
  // Where it is now, heard as it scrolls: by the time it's left, the next page may already have moved it.
  const now = useRef(0);
  useLayoutEffect(() => {
    if (own) return;
    const target = pixels.get(key) ?? 0;
    let settled = false;
    now.current = target;
    const stop = scrollWhenTall(target, () => {
      if (settled) return;
      settled = true;
      now.current = window.scrollY;
    });
    const onScroll = () => {
      if (settled) now.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      // Left before it got there: where it was going is still its place.
      if (!settled) {
        stop();
        now.current = target;
      }
      if (now.current > 0) pixels.set(key, now.current);
      else pixels.delete(key);
    };
  }, [key, own]);
}

/** Keeps a list's place as it's left (unmounted), from `keep`, called with the DOM still there. */
export function useKeepOnLeave(keep: () => void) {
  const latest = useRef(keep);
  useEffect(() => {
    latest.current = keep;
  });
  useLayoutEffect(() => () => latest.current(), []);
}
