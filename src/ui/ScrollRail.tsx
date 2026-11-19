import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Icon } from './Icon';
import { railItem, railLabel, railMarks, railScale, readingLine, scrollFor } from '../domain/rail';

/** The attribute on each item the rail goes by, its place in the rail's `keys`. */
export const RAIL_AT = 'data-rail-at';

/** How long the thumb stays on a touch screen after the page stops scrolling. */
const AWAKE_MS = 1500;
/** How many frames a jump waits for the item it's going to to be drawn. */
const TRIES = 20;

interface Props {
  /** Each item's key, top to bottom: the day it's under, or what else groups it (`railMarks`). */
  keys: readonly string[];
  /** What a key that isn't a day is called, and a day on a rail of months or days. */
  name: (key: string) => string;
  /** Where the items are, each marked with `RAIL_AT`, in the page's order. */
  root: RefObject<HTMLElement | null>;
  /** Draws the item at an index, for a page that draws only some of them at a time. */
  reveal?: (index: number) => void;
}

interface Place {
  /** What's in view, between the title bar and anything at the foot of the screen. */
  top: number;
  height: number;
  /** Where the page is, 0 at the top and 1 at the end (`readingLine`). */
  at: number;
  /** How far the page scrolls. */
  scrollable: number;
}

/** What's in view, below the title bar and above the writing box or the tab bar. */
function viewBounds(): { top: number; height: number } {
  const top = Math.max(0, document.querySelector('.main .page__head')?.getBoundingClientRect().bottom ?? 0);
  let bottom = window.innerHeight;
  for (const el of document.querySelectorAll('.journal-dock:not(.is-idle), .tabbar')) {
    const r = el.getBoundingClientRect();
    if (r.height && r.top > top && r.top < bottom) bottom = r.top;
  }
  return { top, height: Math.max(0, bottom - top) };
}

function measure(root: HTMLElement, n: number): Place {
  const { top, height } = viewBounds();
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const line = readingLine(window.scrollY, scrollable, top, height);
  // The last item starting above the line: they're in order down the page, so a few looks find it among thousands.
  const items = root.querySelectorAll<HTMLElement>(`[${RAIL_AT}]`);
  let found = -1;
  for (let lo = 0, hi = items.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    if (items[mid].getBoundingClientRect().top <= line) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  let at = 0;
  if (found >= 0) {
    const r = items[found].getBoundingClientRect();
    const into = r.height ? Math.min(1, Math.max(0, (line - r.top) / r.height)) : 0;
    at = (Number(items[found].getAttribute(RAIL_AT)) + into) / n;
  } else if (items.length) {
    at = Number(items[0].getAttribute(RAIL_AT)) / n;
  }
  return { top, height, at: Math.min(1, at), scrollable };
}

/**
 * A rail down the right of a long page, as a photo library has, to go anywhere in it at once: the years down it (or
 * the months, or the groups, as `railMarks` picks), a thumb at where the page is, and, pointed at or dragged, the
 * month or day there. A press on it goes there, and a drag goes through the page; the page draws what it goes to
 * (`reveal`). With a mouse it's always there and stands in for the scroll bar; on a touch screen only its thumb
 * shows, while the page scrolls, to be held and dragged, the marks with it. It shows on a page more than half a
 * screen longer than the screen. Screen readers skip it: the page scrolls as ever.
 */
export function ScrollRail({ keys, name, root, reveal }: Props) {
  const n = keys.length;
  const [place, setPlace] = useState<Place | null>(null);
  // Where it's dragged to, and where the pointer is over it.
  const [drag, setDrag] = useState<number | null>(null);
  const [point, setPoint] = useState<number | null>(null);
  // Scrolled lately: the thumb shows on a touch screen.
  const [awake, setAwake] = useState(false);
  const latest = useRef({ n, name, reveal, place });
  latest.current = { n, name, reveal, place };

  useEffect(() => {
    let frame = 0;
    let sleep: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = root.current;
        if (!el) return;
        const next = measure(el, latest.current.n);
        setPlace((was) => (was && Math.abs(was.at - next.at) < 1e-4 && was.top === next.top && was.height === next.height && was.scrollable === next.scrollable ? was : next));
      });
    };
    const onScroll = () => {
      update();
      setAwake(true);
      clearTimeout(sleep);
      sleep = setTimeout(() => setAwake(false), AWAKE_MS);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    // Entries drawn, photos laid out, the writing box growing: each moves things without a scroll.
    const watch = new ResizeObserver(update);
    watch.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(sleep);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      watch.disconnect();
    };
  }, [root, n]);

  // Going somewhere: once a frame, to the last place asked for, waiting for it to be drawn if it isn't yet.
  const jump = useRef({ to: null as number | null, frame: 0, tries: 0 });
  useEffect(() => () => cancelAnimationFrame(jump.current.frame), []);
  const go = (to: number) => {
    const j = jump.current;
    j.to = to;
    j.tries = 0;
    if (j.frame) return;
    const run = () => {
      j.frame = 0;
      const el = root.current;
      if (j.to === null || !el) return;
      const { index, into } = railItem(j.to, latest.current.n);
      const item = el.querySelector<HTMLElement>(`[${RAIL_AT}="${index}"]`);
      if (!item) {
        if (j.tries++ === 0) latest.current.reveal?.(index);
        if (j.tries < TRIES) j.frame = requestAnimationFrame(run);
        return;
      }
      j.to = null;
      const { top, height } = viewBounds();
      const r = item.getBoundingClientRect();
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: scrollFor(window.scrollY + r.top + into * r.height, scrollable, top, height), behavior: 'instant' });
    };
    j.frame = requestAnimationFrame(run);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('is-scrubbing', drag !== null);
    return () => document.documentElement.classList.remove('is-scrubbing');
  }, [drag !== null]);

  const scale = useMemo(() => railScale(keys), [keys]);
  const height = place?.height ?? 0;
  const marks = useMemo(() => railMarks(keys, height, latest.current.name), [keys, height]);

  // Held at the thumb, it moves with the pointer from where it was; pressed elsewhere, it goes there.
  const held = useRef<{ id: number; y: number; from: number } | null>(null);
  const along = (clientY: number) => {
    const p = latest.current.place;
    if (!p || !p.height) return 0;
    const h = held.current;
    return Math.min(1, Math.max(0, h ? h.from + (clientY - h.y) / p.height : (clientY - p.top) / p.height));
  };
  const start = (e: ReactPointerEvent, onThumb: boolean) => {
    if (e.button !== 0 || !place) return;
    e.preventDefault();
    e.stopPropagation();
    held.current = { id: e.pointerId, y: e.clientY, from: onThumb ? place.at : (e.clientY - place.top) / place.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const to = along(e.clientY);
    setDrag(to);
    go(to);
  };
  const move = (e: ReactPointerEvent) => {
    if (held.current?.id === e.pointerId) {
      const to = along(e.clientY);
      setDrag(to);
      go(to);
    } else if (e.pointerType === 'mouse' && place) {
      setPoint(Math.min(1, Math.max(0, (e.clientY - place.top) / place.height)));
    }
  };
  const end = (e: ReactPointerEvent) => {
    if (held.current?.id !== e.pointerId) return;
    held.current = null;
    setDrag(null);
  };

  if (!place || n < 2 || place.scrollable <= place.height / 2 || !place.height) return null;
  const thumb = drag ?? place.at;
  const told = drag ?? point;
  const label = told === null ? null : railLabel(keys[railItem(told, n).index], scale, name);
  const y = (at: number) => at * place.height;
  return (
    <div
      className={`scroll-rail${drag !== null ? ' is-dragging' : ''}${awake ? ' is-awake' : ''}`}
      style={{ top: place.top, height: place.height }}
      aria-hidden="true"
      onPointerDown={(e) => start(e, false)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => setPoint(null)}
    >
      {marks.map((m) =>
        m.label ? (
          <span key={`l${m.at}`} className="scroll-rail__label" style={{ top: y(m.at) }}>
            {m.label}
          </span>
        ) : (
          <span key={`d${m.at}`} className="scroll-rail__dot" style={{ top: y(m.at) }} />
        ),
      )}
      {point !== null && drag === null && <span className="scroll-rail__point" style={{ top: y(point) }} />}
      <span className="scroll-rail__thumb" style={{ top: y(thumb) }} onPointerDown={(e) => start(e, true)}>
        <span className="scroll-rail__grip">
          <Icon name="up" size={12} />
          <Icon name="down" size={12} />
        </span>
      </span>
      {label && (
        <span className="scroll-rail__bubble" style={{ top: Math.min(place.height - 14, Math.max(14, y(told!))) }}>
          {label}
        </span>
      )}
    </div>
  );
}
