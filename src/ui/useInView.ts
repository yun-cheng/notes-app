import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether the element has come near enough to sight to load what it shows: true from then on. Within `margin` of
 * the screen, or of its parent when `inParent` (a row that scrolls on its own). Where the browser can't tell, at once.
 */
export function useInView(ref: RefObject<Element | null>, margin: string, inParent = false): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        watch.disconnect();
      }
    }, { root: inParent ? el.parentElement : null, rootMargin: margin });
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, margin, inParent, seen]);
  return seen;
}
