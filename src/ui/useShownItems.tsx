import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawnRange, stretchFor, type DrawnStretch } from '../domain/rail';
import { STREAM_END } from './ScrollJump';

/** How many entries the stream draws at first, and adds each time the reader nears the end of what's drawn. */
const STREAM_PAGE = 150;

/**
 * The entries (or other items) to draw: the newest ones in a chat (the end nearest the box), the first ones in other orders, and more as
 * the reader scrolls toward the rest. Drawing thousands of bubbles at once makes every change to any entry slow.
 * `before` and `after` are buttons for the ones above and below what's drawn, which also ask for them themselves when
 * they come near the screen. `reach` is the index of one that must be drawn from the start. `noun` names them on those buttons. `reveal` draws a stretch
 * around one far off instead, for the rail (`ScrollRail`); going to the stream's end (`toEnd`) draws that again.
 */
export function useShownItems<T>(items: readonly T[], chat: boolean, reach = -1, noun = 'entries') {
  const n = items.length;
  // Far enough to draw the one at `reach`, an entry gone to.
  const [drawn, setDrawn] = useState<DrawnStretch>(() => ({ skip: 0, count: reach < 0 ? STREAM_PAGE : Math.max(STREAM_PAGE, chat ? n - reach : reach + 1) }));
  const { from, to } = drawnRange(n, chat, drawn);
  const top = useRef<HTMLButtonElement>(null);
  const foot = useRef<HTMLButtonElement>(null);
  // Drawing entries above what's on screen would push it down: keep it where it was.
  const keep = useRef<number | null>(null);
  // Just jumped: the buttons, drawn a moment before the page moves there, may seem near.
  const jumped = useRef(0);
  const ending = useRef(false);
  const latest = useRef(drawn);
  latest.current = drawn;

  const showMore = (above: boolean) => {
    if (above) keep.current = document.documentElement.scrollHeight - window.scrollY;
    // The end away from where the stream opens grows its count; the other end takes from what's skipped.
    setDrawn((d) => (above === chat ? { ...d, count: d.count + STREAM_PAGE } : { skip: Math.max(0, d.skip - STREAM_PAGE), count: d.count + Math.min(STREAM_PAGE, d.skip) }));
  };

  useEffect(() => {
    let later: ReturnType<typeof setTimeout> | undefined;
    const watch = new IntersectionObserver(
      (seen) => {
        const wait = jumped.current + 500 - Date.now();
        for (const entry of seen) {
          if (!entry.isIntersecting) continue;
          // Looked at again once the page has moved, as it's heard of only when it comes near or goes.
          if (wait > 0) {
            later = setTimeout(() => (watch.unobserve(entry.target), watch.observe(entry.target)), wait);
          } else showMore(entry.target === top.current);
        }
      },
      { rootMargin: '1200px 0px' },
    );
    if (top.current) watch.observe(top.current);
    if (foot.current) watch.observe(foot.current);
    return () => {
      clearTimeout(later);
      watch.disconnect();
    };
  }, [from, to, n, chat]);

  useLayoutEffect(() => {
    if (ending.current) {
      ending.current = false;
      keep.current = null;
      window.scrollTo(0, chat ? document.documentElement.scrollHeight : 0);
    }
    if (keep.current === null) return;
    window.scrollTo(0, document.documentElement.scrollHeight - keep.current);
    keep.current = null;
  }, [from, to]);

  useEffect(() => {
    const onEnd = () => {
      if (!latest.current.skip) return;
      ending.current = true;
      setDrawn({ skip: 0, count: STREAM_PAGE });
    };
    window.addEventListener(STREAM_END, onEnd);
    return () => window.removeEventListener(STREAM_END, onEnd);
  }, []);

  const reveal = (index: number) => {
    jumped.current = Date.now();
    setDrawn((d) => stretchFor(items.length, chat, d, index, STREAM_PAGE));
  };

  const button = (above: boolean) => (
    <button ref={above ? top : foot} type="button" className="btn btn--quiet stream__more" onClick={() => showMore(above)}>
      {above ? (chat ? `Show earlier ${noun}` : `Show the ${noun} above`) : chat ? `Show later ${noun}` : `Show more ${noun}`}
    </button>
  );
  return { shown: items.slice(from, to), first: from, before: from > 0 && button(true), after: to < n && button(false), reveal };
}

