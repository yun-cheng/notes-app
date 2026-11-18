import { useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * Props for a dialog's backdrop that close it on a click outside the dialog. A press that starts inside, like
 * selecting text and letting go past the dialog's edge, also ends in a click on the backdrop (the browser sends it
 * to what holds both ends), so only a press that starts on the backdrop counts.
 */
export function useBackdropClose(onClose: () => void) {
  const pressed = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pressed.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const outside = pressed.current && e.target === e.currentTarget;
      pressed.current = false;
      if (outside) onClose();
    },
  };
}
