import { useEffect, useRef, useState, type MouseEvent } from 'react';

/**
 * A small menu that opens from a button: below it, or above it in the lower part of the screen so it clears the
 * writing box. A press outside it or Escape closes it; its Escape comes before the page's own (stop picking,
 * close a sheet), so only the menu closes.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState<'down' | 'up' | null>(null);
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

  const toggle = (e: MouseEvent<HTMLElement>) => setOpen(open ? null : e.currentTarget.getBoundingClientRect().bottom > window.innerHeight * 0.55 ? 'up' : 'down');
  return { open, root, toggle, close: () => setOpen(null) };
}
