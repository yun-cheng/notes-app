import { flushSync } from 'react-dom';

/** Which way a card's pages turn: on to the next page, or from the last back to the front. */
export type PageTurn = 'next' | 'front';

type ViewTransitions = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/** The latest turn: one tapped again before the last has finished cuts it short, and is the one to tidy up after. */
let latest = 0;

/**
 * Turns the page of the bubble `from` is in, like the top card of a deck: on to the next, the page showing slides
 * off to the left and the one behind comes up from under it; back to the front, the front slides back in over it.
 * Both pages are seen at once, so this takes the browser's view transitions (`styles.css`, `page-turn`). False,
 * with nothing done, where there are none or motion is reduced: the caller then turns it without.
 */
export function turnPage(from: Element | null, way: PageTurn, update: () => void): boolean {
  const doc = document as ViewTransitions;
  const bubble = from?.closest<HTMLElement>('.bubble');
  if (!bubble || !doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const root = document.documentElement;
  const turn = ++latest;
  // One bubble at a time carries the name, and only while it turns.
  for (const named of document.querySelectorAll<HTMLElement>('.bubble[style*="view-transition-name"]')) named.style.removeProperty('view-transition-name');
  bubble.style.setProperty('view-transition-name', 'page-turn');
  root.dataset.pageTurn = way;
  const done = () => {
    if (turn !== latest) return;
    bubble.style.removeProperty('view-transition-name');
    delete root.dataset.pageTurn;
  };
  // The page turns once, even if the browser holds the transition back waiting for a frame it never draws.
  let turned = false;
  const turnIt = () => {
    if (turned) return;
    turned = true;
    flushSync(update);
  };
  setTimeout(() => {
    if (turned) return;
    turnIt();
    done();
  }, 400);
  try {
    doc.startViewTransition(turnIt).finished.then(done, done);
  } catch {
    done();
    return false;
  }
  return true;
}
