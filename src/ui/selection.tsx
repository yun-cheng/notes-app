import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
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
  start: () => void;
  selectAll: () => void;
  clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);
export const SelectionProvider = SelectionContext.Provider;

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
 * Click and touch handling for a bubble: Cmd/Ctrl-click picks it, Shift-click picks a range, a long press on a
 * touch screen starts picking, and while picking a plain click picks instead of opening.
 */
export function useSelectable(id: string) {
  const selection = useContext(SelectionContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pressed = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  if (!selection) return { selected: false, handlers: {} };
  return {
    selected: selection.has(id),
    handlers: {
      onClick: (e: MouseEvent) => {
        if (pressed.current) {
          // The long press already picked it.
          pressed.current = false;
          e.preventDefault();
          return;
        }
        if (selection.selecting || e.metaKey || e.ctrlKey || e.shiftKey) {
          e.preventDefault();
          selection.toggle(id, e.shiftKey);
        }
      },
      onPointerDown: (e: PointerEvent) => {
        pressed.current = false;
        if (e.pointerType !== 'touch') return;
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => {
          pressed.current = true;
          selection.toggle(id);
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: MouseEvent) => {
        if (timer.current || pressed.current) e.preventDefault();
      },
    },
  };
}
