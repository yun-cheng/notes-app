import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { rangeBetween } from '../domain/batch';

/** Entries picked in the journal for a batch change. */
export interface Selection {
  /** On while anything on screen is picked; unpicking the last one stops it. Clicking a bubble then picks it instead of opening it. */
  selecting: boolean;
  /** Picked IDs that are still on screen, in stream order. */
  ids: string[];
  has: (id: string) => boolean;
  /** Picks or unpicks one entry; with `range`, everything from the last one picked. */
  toggle: (id: string, range?: boolean) => void;
  /** Picks these entries; `add` keeps what was picked before, otherwise they replace it. */
  setMany: (ids: string[], add: boolean) => void;
  selectAll: () => void;
  clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);
export const SelectionProvider = SelectionContext.Provider;
export const useSelection = () => useContext(SelectionContext);

/** Selection over the entries in `order`. Picks that scroll out of a filter are kept but not counted. */
export function useSelectionState(order: string[]): Selection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const ids = order.filter((id) => picked.has(id));
  const selecting = ids.length > 0;

  // Nothing picked left on screen (unpicked, trashed, or filtered away): picking stops, and hidden picks go with it.
  useEffect(() => {
    if (!selecting && picked.size) {
      setPicked(new Set());
      anchor.current = null;
    }
  }, [selecting, picked]);

  const selection: Selection = {
    selecting,
    ids,
    has: (id) => picked.has(id),
    toggle: (id, range) => {
      // Read the last pick now; the update below runs after it has moved on to this one.
      const from = range ? anchor.current : null;
      setPicked((now) => {
        const next = new Set(now);
        if (from) rangeBetween(order, from, id).forEach((x) => next.add(x));
        else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    },
    setMany: (ids, add) => {
      setPicked((now) => new Set(add ? [...now, ...ids] : ids));
      if (ids.length) anchor.current = ids[ids.length - 1];
    },
    selectAll: () => setPicked(new Set(order)),
    clear: () => {
      setPicked(new Set());
      anchor.current = null;
    },
  };

  // Escape stops selecting, unless a dialog is open to take it. The other keys are in `useEntryShortcuts`.
  const latest = useRef(selection);
  latest.current = selection;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop') || e.defaultPrevented) return;
      if (e.key === 'Escape') latest.current.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  return selection;
}

const LONG_PRESS_MS = 450;

const BUBBLES = '[data-entry-id] > [role="article"]';

/**
 * Scrolls a bubble into the part of the page nothing covers: under the title bar and the day badge pinned below it,
 * above the writing box at the foot. One taller than that shows from its top.
 */
export function revealBubble(el: HTMLElement) {
  // The day badge pins just under the title bar.
  const day = document.querySelector<HTMLElement>('.stream__day')?.offsetHeight ?? 0;
  const top = (document.querySelector('.page__head')?.getBoundingClientRect().bottom ?? 0) + day + 12;
  const bottom = (document.querySelector('.journal-dock')?.getBoundingClientRect().top ?? window.innerHeight) - 8;
  const r = el.getBoundingClientRect();
  if (r.top < top) window.scrollBy(0, r.top - top);
  else if (r.bottom > bottom) window.scrollBy(0, Math.min(r.bottom - bottom, r.top - top));
}

/** The bubbles in the stream `from` is in, in order. */
const streamBubbles = (from: Element) => [...(from.closest('.stream')?.querySelectorAll<HTMLElement>(BUBBLES) ?? [])];

/**
 * Into the stream from the keyboard, when nothing has the focus (as after a click on empty space): ↓ focuses the
 * first bubble on the screen and ↑ the last, so the arrows go on from there. False if there's none to focus.
 */
export function focusStream(way: 'down' | 'up'): boolean {
  const shown = [...document.querySelectorAll<HTMLElement>(`.stream ${BUBBLES}`)].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
  });
  const to = way === 'down' ? shown[0] : shown[shown.length - 1];
  if (!to) return false;
  to.focus({ preventScroll: true });
  revealBubble(to);
  return true;
}

/**
 * Click, key and touch handling for a bubble. With a mouse, a click leaves the bubble alone, so its text can be
 * selected and copied; the open button, or Enter on the focused bubble, opens it. On a touch screen a tap opens
 * it and a long press starts picking. Cmd/Ctrl-click picks it, Shift-click picks a range, and while picking any
 * click or tap picks. Up and down arrows move between bubbles, picking along the way with Shift, and Home and End go
 * to the first and the last. A right-click with a mouse, or the menu key, opens `onMenu`.
 */
export function useSelectable(id: string, open: (edit?: boolean) => void, onMenu?: (e: ReactMouseEvent<HTMLElement>) => void) {
  const selection = useContext(SelectionContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const touch = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  const selected = !!selection?.has(id);
  return {
    selected,
    handlers: {
      tabIndex: 0,
      onClick: (e: ReactMouseEvent) => {
        if (e.target instanceof Element && e.target.closest('a, button, input, label')) return;
        if (pressed.current) {
          // The long press already picked it.
          pressed.current = false;
          return;
        }
        if (selection && (selection.selecting || e.metaKey || e.ctrlKey || e.shiftKey)) {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          selection.toggle(id, e.shiftKey);
          return;
        }
        // A tap opens; a mouse click is left for selecting text.
        if (touch.current && !String(window.getSelection() ?? '')) open();
      },
      onKeyDown: (e: ReactKeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          // Enter is Edit's shortcut, so it opens ready to type too.
          open(true);
        } else if (e.key === ' ' && selection) {
          e.preventDefault();
          selection.toggle(id, e.shiftKey);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
          // To the next or previous bubble, or the first or last; with Shift, picking from here to there.
          const bubbles = streamBubbles(e.currentTarget);
          const here = bubbles.indexOf(e.currentTarget as HTMLElement);
          const next = bubbles[e.key === 'Home' ? 0 : e.key === 'End' ? bubbles.length - 1 : here + (e.key === 'ArrowDown' ? 1 : -1)];
          const nextId = next?.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
          if (!next || !nextId) return;
          e.preventDefault();
          next.focus({ preventScroll: true });
          revealBubble(next);
          if (e.shiftKey && selection) {
            if (!selection.has(id)) selection.toggle(id);
            selection.toggle(nextId, true);
          }
        }
      },
      onPointerDown: (e: ReactPointerEvent) => {
        pressed.current = false;
        touch.current = e.pointerType !== 'mouse';
        if (e.pointerType !== 'touch' || !selection) return;
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => {
          pressed.current = true;
          selection.toggle(id);
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        // A long press picks the entry instead.
        if (timer.current || pressed.current) return e.preventDefault();
        if (!touch.current) onMenu?.(e);
      },
    },
  };
}

/** Where a drag started and where it is now, in page coordinates so scrolling during the drag counts. */
interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  add: boolean;
  before: string[];
}

/** Where a click doesn't end picking: the entries, the bar acting on them, and the page's own controls. */
const KEEPS_PICKING = '.stream__entry, .batch, .page__head, .sidebar, .tabbar, .dialog-backdrop, .toast-slot, .link-menu, .context-menu';

/** Things a drag can't start on, so clicks on them still work. */
const INTERACTIVE = '.bubble, .attachments, .pick, a, button, input, textarea, select, label, [contenteditable="true"]';

/** Parts of the page a drag can't start in, though they sit in the main area. */
const NO_BOX = '.page__head, .composer, .composer__unlock, .batch, .dialog-backdrop, .toast-slot, .link-menu, .stack__cards';

/**
 * Picking from empty space. A click (or tap) on a row beside its bubble picks or unpicks that entry, Shift-click a
 * range. Pressing anywhere empty in the main area, beside the stream too, and dragging picks every entry the box
 * touches, as it moves; Shift or Cmd/Ctrl adds to what was picked. Entries are found by `[data-entry-id]` in `root`.
 */
export function useBoxSelect(root: RefObject<HTMLElement | null>, selection: Selection | null) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ drag, selection });
  latest.current = { drag, selection };
  // Set once a press has moved far enough to be a drag, so the click that ends it doesn't also pick a row.
  const dragged = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el || !selection) return;

    const onClick = (e: MouseEvent) => {
      if (dragged.current || !(e.target instanceof Element) || e.target.closest(INTERACTIVE)) return;
      const row = e.target.closest<HTMLElement>('[data-entry-id]');
      if (row?.dataset.entryId) latest.current.selection?.toggle(row.dataset.entryId, e.shiftKey);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !(e.target instanceof Element)) return;
      if (!e.target.closest('.main') || e.target.closest(INTERACTIVE) || e.target.closest(NO_BOX)) return;
      e.preventDefault();
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;
      setDrag({ x0: x, y0: y, x1: x, y1: y, add, before: add ? (latest.current.selection?.ids ?? []) : [] });
    };
    // A click anywhere else ends picking.
    const onPress = () => {
      dragged.current = false;
    };
    const onOutside = (e: MouseEvent) => {
      const current = latest.current.selection;
      if (!current?.selecting || dragged.current) return;
      if (e.target instanceof Element && (e.target.closest(KEEPS_PICKING) || !e.target.isConnected)) return;
      current.clear();
    };
    document.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick);
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('click', onOutside);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('click', onOutside);
    };
  }, [root, selection !== null]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let last = { x: 0, y: 0 };
    const at = (e: { clientX: number; clientY: number }) => (last = { x: e.clientX, y: e.clientY });
    const move = (e: PointerEvent) => {
      at(e);
      const d = latest.current.drag;
      if (!d) return;
      const next = { ...d, x1: e.clientX + window.scrollX, y1: e.clientY + window.scrollY };
      // A small wobble is a click, not a drag.
      if (Math.hypot(next.x1 - d.x0, next.y1 - d.y0) < 6) return setDrag(next);
      dragged.current = true;
      updateFrom(next);
    };
    const scroll = () => {
      const d = latest.current.drag;
      if (d) updateFrom({ ...d, x1: last.x + window.scrollX, y1: last.y + window.scrollY });
    };
    /** Picks every entry the box touches, plus what was picked before when adding. */
    const updateFrom = (d: Drag) => {
      setDrag(d);
      const el = root.current;
      if (!el) return;
      const [left, right] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)];
      const [top, bottom] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
      const ids = [...el.querySelectorAll<HTMLElement>('[data-entry-id]')]
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return r.right + window.scrollX >= left && r.left + window.scrollX <= right && r.bottom + window.scrollY >= top && r.top + window.scrollY <= bottom;
        })
        .map((node) => node.dataset.entryId!);
      latest.current.selection?.setMany([...d.before, ...ids], false);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('scroll', scroll);
    };
  }, [dragging, root]);

  if (!drag || Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) < 6) return null;
  const style = {
    left: Math.min(drag.x0, drag.x1) - window.scrollX,
    top: Math.min(drag.y0, drag.y1) - window.scrollY,
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
  return <div className="box-select" style={style} aria-hidden />;
}
