import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export const MAX_ZOOM = 6;
const DOUBLE_CLICK_ZOOM = 2.5;

export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

export const FIT: Zoom = { scale: 1, x: 0, y: 0 };

/** How far the photo may move at a zoom: no further than its own edges reach, so some of it always fills its place. */
export function clampZoom(z: Zoom, width: number, height: number): Zoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, z.scale));
  if (scale === 1) return FIT;
  const mx = (width * (scale - 1)) / 2;
  const my = (height * (scale - 1)) / 2;
  return { scale, x: Math.min(mx, Math.max(-mx, z.x)), y: Math.min(my, Math.max(-my, z.y)) };
}

/**
 * Zoomed to `scale` keeping the point under (`px`, `py`) where it is. `cx`, `cy` is the middle of the photo as it
 * sits now; the photo scales from its middle.
 */
export function zoomAt(z: Zoom, scale: number, px: number, py: number, cx: number, cy: number): Zoom {
  const k = scale / z.scale;
  // The middle without the move: where the photo would sit at no zoom.
  const ox = cx - z.x;
  const oy = cy - z.y;
  return { scale, x: px - ox - (px - cx) * k, y: py - oy - (py - cy) * k };
}

/**
 * Zoom for a photo shown full screen: the wheel (and a trackpad pinch, which the browser sends as a wheel with Ctrl)
 * zooms around the pointer, a drag moves a zoomed photo, two fingers pinch, a double-click goes between fitted and
 * zoomed in, and + - 0 do it from the keyboard. Back to fitted whenever `key` (the photo shown) changes.
 */
export function usePhotoZoom(key: string) {
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const img = useRef<HTMLImageElement>(null);
  const area = useRef<HTMLDivElement>(null);
  // What the photo shows (the last render), and the zoom asked for since, which wheel turns quicker than a frame
  // build on.
  const shown = useRef(zoom);
  shown.current = zoom;
  const latest = useRef(zoom);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const set = (next: Zoom) => {
    latest.current = next;
    setZoom(next);
  };
  useEffect(() => set(FIT), [key]);

  /** Zoom to `scale` around a point on the screen, or the photo's middle. */
  const to = (scale: number, at?: { x: number; y: number }) => {
    const el = img.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = latest.current;
    // The middle as last drawn, moved on to where the zoom asked for since puts it.
    const cx = r.left + r.width / 2 - shown.current.x + z.x;
    const cy = r.top + r.height / 2 - shown.current.y + z.y;
    const next = zoomAt(z, Math.min(MAX_ZOOM, Math.max(1, scale)), at?.x ?? cx, at?.y ?? cy, cx, cy);
    set(clampZoom(next, el.offsetWidth, el.offsetHeight));
  };

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      // The row of photos scrolls sideways under the wheel instead.
      const row = target?.closest<HTMLElement>('.viewer__strip');
      if (row) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          row.scrollLeft += e.deltaY;
        }
        return;
      }
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const step = -e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.0025);
      const photo = img.current?.getBoundingClientRect();
      const over = photo && e.clientX >= photo.left && e.clientX <= photo.right && e.clientY >= photo.top && e.clientY <= photo.bottom;
      to(latest.current.scale * Math.exp(step), over ? { x: e.clientX, y: e.clientY } : undefined);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer already gone; its moves just aren't kept to the photo.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const all = pointers.current;
    const before = all.get(e.pointerId);
    if (!before) return;
    const now = { x: e.clientX, y: e.clientY };
    if (all.size === 2) {
      const other = [...all.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const was = Math.hypot(before.x - other.x, before.y - other.y);
        const is = Math.hypot(now.x - other.x, now.y - other.y);
        if (was > 0) to(latest.current.scale * (is / was), { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 });
      }
    } else if (latest.current.scale > 1) {
      const el = img.current;
      const z = latest.current;
      if (el) set(clampZoom({ ...z, x: z.x + now.x - before.x, y: z.y + now.y - before.y }, el.offsetWidth, el.offsetHeight));
    }
    all.set(e.pointerId, now);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => void pointers.current.delete(e.pointerId);

  const style: CSSProperties = {
    transform: zoom.scale === 1 ? undefined : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
    cursor: zoom.scale > 1 ? 'grab' : 'zoom-in',
  };

  return {
    zoom,
    area,
    /** Props for the photo. */
    image: {
      ref: img,
      style,
      draggable: false,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: (e: { clientX: number; clientY: number }) => to(latest.current.scale > 1 ? 1 : DOUBLE_CLICK_ZOOM, { x: e.clientX, y: e.clientY }),
    },
    zoomIn: () => to(latest.current.scale * 1.5),
    zoomOut: () => to(latest.current.scale / 1.5),
    fit: () => set(FIT),
  };
}
