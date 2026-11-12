import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { rangeBetween } from '../domain/batch';

/** Entries picked in the journal for a batch change. */
export interface Selection {
  /** On while picking, even with nothing picked yet. Clicking a bubble then picks it instead of opening it. */
  selecting: boolean;
  /** Picked IDs that are still on screen, in stream order. */
  ids: string[];
  has: (id: string) => boolean;
  /** Picks or unpicks one entry; with `range`, everything from the last one picked. */
  toggle: (id: string, range?: boolean) => void;
  /** Picks these entries; `add` keeps what was picked before, otherwise they replace it. */
  setMany: (ids: string[], add: boolean) => void;
  start: () => void;
  selectAll: () => void;
  clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);
export const SelectionProvider = SelectionContext.Provider;
export const useSelection = () => useContext(SelectionContext);

/** Selection over the entries in `order`. Picks that scroll out of a filter are kept but not counted. */
export function useSelectionState(order: string[]): Selection {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const ids = order.filter((id) => picked.has(id));

  const selection: Selection = {
    selecting,
    ids,
    has: (id) => picked.has(id),
    toggle: (id, range) => {
      // Read the last pick now; the update below runs after it has moved on to this one.
      const from = range ? anchor.current : null;
      setSelecting(true);
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
      setSelecting(true);
      setPicked((now) => new Set(add ? [...now, ...ids] : ids));
      if (ids.length) anchor.current = ids[ids.length - 1];
    },
    start: () => setSelecting(true),
    selectAll: () => {
      setSelecting(true);
      setPicked(new Set(order));
    },
    clear: () => {
      setSelecting(false);
      setPicked(new Set());
      anchor.current = null;
    },
  };

  // Escape stops selecting, unless a dialog is open to take it. Cmd+A picks everything shown.
  const latest = useRef(selection);
  latest.current = selection;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop') || e.defaultPrevented) return;
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape') latest.current.clear();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault();
        latest.current.selectAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  return selection;
}

const LONG_PRESS_MS = 450;

/**
 * Click, key and touch handling for a bubble. With a mouse, a click leaves the bubble alone, so its text can be
 * selected and copied; the open button, or Enter on the focused bubble, opens it. On a touch screen a tap opens
 * it and a long press starts picking. Cmd/Ctrl-click picks it, Shift-click picks a range, and while picking any
 * click or tap picks.
 */
export function useSelectable(id: string, open: () => void) {
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
          open();
        } else if (e.key === ' ' && selection) {
          e.preventDefault();
          selection.toggle(id, e.shiftKey);
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
      onContextMenu: (e: ReactMouseEvent) => {
        if (timer.current || pressed.current) e.preventDefault();
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

/** Things a drag can't start on, so clicks on them still work. */
const INTERACTIVE = '.bubble, .attachments, .pick, a, button, input, textarea, select, label, [contenteditable="true"]';

/**
 * Box-selecting: pressing on the stream's empty space and dragging picks every entry the box touches, as it
 * moves. Shift or Cmd/Ctrl adds to what was picked. Entries are found by `[data-entry-id]` inside `root`.
 */
export function useBoxSelect(root: RefObject<HTMLElement | null>, selection: Selection | null) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ drag, selection });
  latest.current = { drag, selection };

  useEffect(() => {
    const el = root.current;
    if (!el || !selection) return;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
      e.preventDefault();
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;
      setDrag({ x0: x, y0: y, x1: x, y1: y, add, before: add ? (latest.current.selection?.ids ?? []) : [] });
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
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
