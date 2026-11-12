import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';

/**
 * A small menu that opens from a button: below it, or above it in the lower part of the screen so it clears the
 * writing box. A press outside it or Escape closes it; its Escape comes before the page's own (stop picking,
 * close a sheet), so only the menu closes.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState<'down' | 'up' | null>(null);
  // Where the button was when it opened, for a menu that has to sit outside a scrolling box (`fixedStyle`).
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const root = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(null);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor(rect);
    setOpen(open ? null : rect.bottom > window.innerHeight * 0.55 ? 'up' : 'down');
  };
  /** A fixed position beside the button, for a menu inside a box that would clip it, like a sheet that scrolls. */
  const fixedStyle = (width: number): CSSProperties | undefined =>
    anchor
      ? {
          position: 'fixed',
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
          ...(open === 'up' ? { top: 'auto', bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6, bottom: 'auto' }),
        }
      : undefined;
  return { open, root, toggle, fixedStyle, close: () => setOpen(null) };
}
