import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/** How far from its end the page must be before the button to jump back there shows. */
const AWAY = 400;

const distanceTo = (end: 'top' | 'bottom') =>
  end === 'top' ? window.scrollY : document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

/**
 * A round button that jumps back to the end the journal opens at: the bottom in a chat, the top in other orders.
 * It shows only once the page is well away from there, and sits just above the writing box, moving with it as it grows.
 */
export function ScrollJump({ to }: { to: 'top' | 'bottom' }) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setAway(distanceTo(to) > AWAY));
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // Entries arriving or more being drawn change how far the bottom is without a scroll.
    const watch = new ResizeObserver(measure);
    watch.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      watch.disconnect();
    };
  }, [to]);

  if (!away) return null;
  const label = to === 'top' ? 'Scroll to top' : 'Scroll to bottom';
  const jump = () => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: to === 'top' ? 0 : document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  return (
    // Not taking focus, so a half-written entry keeps its cursor.
    <button type="button" className="scroll-jump" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={jump}>
      <Icon name={to === 'top' ? 'up' : 'down'} />
    </button>
  );
}
