import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { rangeBetween } from '../../domain/batch';
import { displayTitle } from '../../domain/content';
import { relativeDay } from '../../domain/dates';
import { useNavigate, useSearchParams } from 'react-router';
import { layoutPhotos, mediaShowing, photoDays, type Box, type MediaShown, type PhotoItem } from '../../domain/photos';
import { isFiltered } from '../../domain/stream';
import { useToday } from '../../state/CardsContext';
import { mediaCount, PhotoViewer, videosIn } from '../Attachments';
import { Empty, Page } from '../components';
import type { Point } from '../EntryMenu';
import { usePhotoUrl } from '../editor/photo';
import { FilterBar, FilterSheetButton } from '../FilterPanel';
import { Icon } from '../Icon';
import { useCopyPhoto } from '../copyPhoto';
import { canSharePhotos, usePhotoActions } from '../photoActions';
import { LONG_PRESS_MS } from '../selection';
import { MOD } from '../Shortcuts';
import { Item } from '../EntryMenu';
import { libraryPath, mediaShownIn, PHOTOS_PATH } from '../paths';
import { ScrollRail } from '../ScrollRail';
import { DriveLinkItems } from '../driveLink';
import { useInView } from '../useInView';
import { HoverPlay, VideoMark, VideoStill } from '../video';
import { HeldMenu, menuAt, useEntryActions, useLibrary } from './library';

/**
 * Each photo's width over its height, once it's been shown, kept on this device so the page lays out at once next
 * time instead of moving as photos load. Storage can be off; then it's kept for this visit.
 */
const SHAPES_KEY = 'notes-app:photo-shapes';
const shapes: Map<string, number> = (() => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SHAPES_KEY) ?? '{}');
    return new Map(Object.entries(raw ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0));
  } catch {
    return new Map<string, number>();
  }
})();
let saving: ReturnType<typeof setTimeout> | null = null;
function keepShape(id: string, ratio: number) {
  shapes.set(id, ratio);
  if (saving) return;
  saving = setTimeout(() => {
    saving = null;
    try {
      localStorage.setItem(SHAPES_KEY, JSON.stringify(Object.fromEntries(shapes)));
    } catch {
      // Kept for this visit.
    }
  }, 500);
}

/** The layout's sizes: rows lower on a phone. */
const sizes = (width: number) =>
  width < 600 ? { width, row: 120, gap: 3, dayGap: 12, head: 40 } : { width, row: 200, gap: 4, dayGap: 16, head: 44 };

/**
 * Every photo and video in the journal, newest first (a video marked with its length, playing full screen), under the day its entry was written, laid out as a photo library does:
 * whole, in rows of about one height that fill the width, a day with a few beside the day before (`layoutPhotos`).
 * A photo opens full screen, where all of them page past in turn, each naming its entry, which opens from there.
 * The journal's filters narrow it: one tag's photos, one vault's, or those in todos; a switch first in the filter row,
 * to photos alone or videos alone. Photos load as they come near.
 *
 * Photos are picked as in a photo library: by the check on each (or on a day, for all of it), Cmd/Ctrl-click, a long
 * press on a touch screen, or Cmd/Ctrl+A for all; then a click picks, and Shift picks everything from the last one.
 * The bar on top then copies one, or downloads or shares all of them. Escape stops.
 */
export function PhotosPage() {
  const today = useToday();
  const { filter, days: found } = useLibrary(photoDays);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const show = mediaShownIn(params);
  const days = useMemo(() => mediaShowing(found, show), [found, show]);
  const all = useMemo(() => days.flatMap((d) => d.items), [days]);
  const railKeys = useMemo(() => all.map((i) => i.day), [all]);
  const [viewing, setViewing] = useState<number | null>(null);
  const entry = useEntryActions();
  const copyPhoto = useCopyPhoto();
  const act = usePhotoActions();
  // A photo right-clicked, in the grid or full screen: its entry, to open or go to.
  const [menu, setMenu] = useState<{ at: number; point: Point } | null>(null);
  const openEntry = (item: PhotoItem) => {
    setViewing(null);
    entry.open(item.card);
  };

  // The photos picked, by ID (each shows once here). Picks a filter hides are let go.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const order = useMemo(() => all.map((i) => i.id), [all]);
  const chosen = all.filter((i) => picked.has(i.id));
  const selecting = chosen.length > 0;
  useEffect(() => {
    if (!selecting && picked.size) setPicked(new Set());
  }, [selecting, picked]);
  const pick = (id: string, range = false) => {
    const from = range ? anchor.current : null;
    setPicked((now) => {
      const next = new Set(now);
      if (from) rangeBetween(order, from, id).forEach((x) => next.add(x));
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  };
  const pickDay = (ids: string[]) => {
    setPicked((now) => {
      const next = new Set(now);
      if (ids.every((id) => now.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    anchor.current = ids.at(-1) ?? null;
  };
  const clear = () => {
    setPicked(new Set());
    anchor.current = null;
  };

  // Cmd/Ctrl+A picks them all, Cmd/Ctrl+C copies the one picked, and Escape stops; a photo full screen or a menu takes the keys first.
  const keys = useRef({ order, selecting, chosen, clear, copyPhoto });
  keys.current = { order, selecting, chosen, clear, copyPhoto };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('.dialog-backdrop, .context-menu')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = keys.current;
      const mod = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      if (e.key === 'Escape' && k.selecting) {
        e.preventDefault();
        k.clear();
      } else if (mod && e.key.toLowerCase() === 'a' && k.order.length) {
        e.preventDefault();
        setPicked(new Set(k.order));
      } else if (mod && e.key.toLowerCase() === 'c' && k.chosen.length === 1 && !k.chosen[0].video && !window.getSelection()?.toString()) {
        e.preventDefault();
        k.copyPhoto(k.chosen[0].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The width to fill, and a count of shapes learned, each a new layout.
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [learned, setLearned] = useState(0);
  const any = all.length > 0;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // At once, as well: a page in the background may not hear from the observer until it's shown.
    setWidth(el.clientWidth);
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, [any]);
  const layout = useMemo(
    () => (width ? layoutPhotos(days.map((d) => d.items.map((i) => shapes.get(i.id) ?? 1)), sizes(width)) : null),
    [days, width, learned],
  );
  // The stretch of the canvas near the screen, in its own pixels: only what's in it is drawn, as thousands of tiles
  // at once take seconds to lay out. It moves in steps of half a screen, so scrolling redraws now and then, not on
  // every frame.
  const [near, setNear] = useState<readonly [number, number]>([0, 0]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top;
        const screen = window.innerHeight;
        const step = Math.max(200, screen / 2);
        const from = Math.floor((-top - screen * 1.5) / step) * step;
        const to = Math.ceil((-top + screen * 2.5) / step) * step;
        setNear((was) => (was[0] === from && was[1] === to ? was : [from, to]));
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [any]);
  const tiles = useMemo(() => layout?.tiles.flat() ?? [], [layout]);
  // The rail going to a photo not drawn: scroll near it, which draws it, and the rail finds it the frame after.
  const reveal = (index: number) => {
    const el = canvas.current;
    const box = tiles[index];
    if (el && box) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + box.y - window.innerHeight / 3, behavior: 'instant' });
  };
  const onShape = (id: string, ratio: number) => {
    if (Math.abs((shapes.get(id) ?? 1) - ratio) < 0.01) return;
    keepShape(id, ratio);
    setLearned((n) => n + 1);
  };

  const caption = (at: number) => {
    const { card, day } = all[at];
    const title = displayTitle(card) || 'Untitled';
    return (
      <button
        type="button"
        className="viewer__caption"
        aria-label={`Open the entry: ${title}`}
        onClick={() => openEntry(all[at])}
      >
        <span className="viewer__caption-title">{title}</span>
        <span className="viewer__caption-day">{relativeDay(day, today)}</span>
        <Icon name="right" size={14} />
      </button>
    );
  };

  const entries = new Set(all.map((i) => i.card.id)).size;
  const videos = useMemo(() => videosIn(all), [all]);
  let n = 0;
  return (
    <Page
      viewOnly={false}
      title={
        selecting ? (
          <span className="photos__picked">
            <button type="button" className="icon-btn photos__unpick" aria-label="Stop selecting" title="Stop selecting (Esc)" onClick={clear}>
              ×
            </button>
            {chosen.length} selected
          </span>
        ) : (
          'Photos'
        )
      }
      actions={
        selecting ? (
          <>
            {chosen.length === 1 && !chosen[0].video && (
              <button type="button" className="icon-btn" aria-label="Copy photo" title={`Copy the photo (${MOD}C)`} onClick={() => copyPhoto(chosen[0].id)}>
                <Icon name="copy" />
              </button>
            )}
            {canSharePhotos() && (
              <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={() => void act.share(chosen)}>
                <Icon name="share" />
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Download" title={chosen.length === 1 ? 'Download' : 'Download, in a zip'} onClick={() => void act.download(chosen)}>
              <Icon name="download" />
            </button>
          </>
        ) : (
          <FilterSheetButton filter={filter} />
        )
      }
      below={
        <FilterBar
          filter={filter}
          lead={
            <span className="segmented filter-switch" role="group" aria-label="Show">
              {SHOWN.map(([value, label]) => (
                <button key={label} type="button" aria-pressed={show === value} onClick={() => void navigate(libraryPath(PHOTOS_PATH, filter, undefined, value))}>
                  {label}
                </button>
              ))}
            </span>
          }
        />
      }
    >
      {!all.length ? (
        <Empty>{emptyText(show, isFiltered(filter))}</Empty>
      ) : (
        <div className={`photos${selecting ? ' is-selecting' : ''}`}>
          <p className="photos__count">
            {mediaCount(all)}, in {entries === 1 ? '1 entry' : `${entries} entries`}
          </p>
          <div className="photos__canvas" ref={canvas} style={{ height: layout?.height }}>
            {layout &&
              days.map(({ day, items }, d) => {
                const first = n;
                n += items.length;
                const head = layout.heads[d];
                const boxes = layout.tiles[d];
                const foot = boxes.reduce((y, b) => Math.max(y, b.y + b.h), head.y + head.h);
                if (foot < near[0] || head.y > near[1]) return null;
                const ids = items.map((i) => i.id);
                const whole = ids.every((id) => picked.has(id));
                const label = relativeDay(day, today);
                return (
                  <section key={day} className="photos__daygroup" aria-label={label}>
                    <h2 className="photos__day" style={{ left: head.x, top: head.y, width: head.w, height: head.h }}>
                      <button
                        type="button"
                        className={`photos__check photos__check--day${whole ? ' is-picked' : ''}`}
                        role="checkbox"
                        aria-checked={whole}
                        aria-label={`Select ${label}`}
                        title={whole ? `Unselect ${label}` : `Select ${label}`}
                        onClick={() => pickDay(ids)}
                      >
                        <Icon name="check" size={12} />
                      </button>
                      <span className="photos__day-name">{label}</span>
                    </h2>
                    {items.map((item, i) => (
                      boxes[i].y + boxes[i].h < near[0] || boxes[i].y > near[1] ? null : <Tile
                        key={item.id}
                        item={item}
                        at={first + i}
                        box={layout.tiles[d][i]}
                        picked={picked.has(item.id)}
                        selecting={selecting}
                        onShape={onShape}
                        onOpen={() => setViewing(first + i)}
                        onPick={(range) => pick(item.id, range)}
                        onMenu={(point) => setMenu({ at: first + i, point })}
                      />
                    ))}
                  </section>
                );
              })}
          </div>
          <ScrollRail keys={railKeys} name={(day) => relativeDay(day, today)} root={canvas} reveal={reveal} />
        </div>
      )}
      {viewing !== null && (
        <PhotoViewer ids={order} videos={videos} start={viewing} onClose={() => setViewing(null)} caption={caption} onMenu={(at, point) => setMenu({ at, point })} />
      )}
      {menu && all[menu.at] && (
        <HeldMenu
          card={all[menu.at].card}
          day={all[menu.at].day}
          at={menu.point}
          label={all[menu.at].video ? 'Video' : 'Photo'}
          onOpen={() => openEntry(all[menu.at])}
          onShow={() => entry.show(all[menu.at].card)}
          onClose={() => setMenu(null)}
          lead={
            <>
              <div className="style-menu__group">
                {all[menu.at].video ? (
                  <Item icon="download" onClick={() => (setMenu(null), void act.download([all[menu.at]]))}>
                    Download video
                  </Item>
                ) : (
                  <Item icon="copy" onClick={() => (setMenu(null), copyPhoto(all[menu.at].id))}>
                    Copy photo
                  </Item>
                )}
                {viewing === null && (
                  <Item icon="check" onClick={() => (setMenu(null), pick(all[menu.at].id))}>
                    {picked.has(all[menu.at].id) ? 'Unselect' : 'Select'}
                  </Item>
                )}
              </div>
              <DriveLinkItems id={all[menu.at].video?.id ?? all[menu.at].id} noun={all[menu.at].video ? 'video' : 'photo'} onClose={() => setMenu(null)} />
            </>
          }
        />
      )}
    </Page>
  );
}

/**
 * A photo in the layout, at its place; it loads once it's near the screen. Pressed, it opens, or while picking it's
 * picked (with Shift, everything from the last one). Its check, Cmd/Ctrl-click or a long press on a touch screen
 * picks it. A right-click with a mouse opens its menu.
 */
/** The switch first in the filter row: everything, or photos alone, or videos alone. */
const SHOWN: [MediaShown, string][] = [
  [undefined, 'All'],
  ['photos', 'Photos'],
  ['videos', 'Videos'],
];

function emptyText(show: MediaShown, filtered: boolean): string {
  if (show) return `No ${show} here${filtered ? ' match' : ''}. Pick All above to see everything${filtered ? ', or take a filter off' : ''}.`;
  return filtered ? 'No photos or videos here match. Take a filter off above, or pick another.' : 'No photos or videos yet. Add one to an entry with its photo button, or paste or drop one in.';
}

function Tile({ item, at, box, picked, selecting, onShape, onOpen, onPick, onMenu }: { item: PhotoItem; at: number; box: Box; picked: boolean; selecting: boolean; onShape: (id: string, ratio: number) => void; onOpen: () => void; onPick: (range: boolean) => void; onMenu: (at: Point) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, '600px 0px');
  const press = useLongPress(() => onPick(false));
  const title = displayTitle(item.card) || 'Untitled';
  // A mouse resting on a video plays it, muted; a finger's touch doesn't.
  const [hover, setHover] = useState(false);
  return (
    <div ref={ref} className={`photo-tile${picked ? ' is-picked' : ''}`} data-rail-at={at} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <button
        type="button"
        className="photo-tile__open"
        aria-label={`${item.video ? 'Video' : 'Photo'} in ${title}`}
        onClick={(e) => {
          if (press.fired()) return;
          if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) onPick(e.shiftKey);
          else onOpen();
        }}
        // Shift keeps the browser's menu, to save the photo, say. A long press on a touch screen picks instead.
        onContextMenu={(e: MouseEvent) => (press.touch() ? e.preventDefault() : menuAt(onMenu)(e))}
        {...press.handlers}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {seen && (item.video ? <VideoStill file={item.video} onShape={(r) => onShape(item.id, r)} /> : <TileImage id={item.id} onShape={(r) => onShape(item.id, r)} />)}
        {seen && item.video && <HoverPlay file={item.video} on={hover} />}
        {item.video && <VideoMark duration={item.video.duration} />}
      </button>
      <button
        type="button"
        className={`photos__check${picked ? ' is-picked' : ''}`}
        role="checkbox"
        aria-checked={picked}
        aria-label={`Select the ${item.video ? 'video' : 'photo'} in ${title}`}
        title={picked ? 'Unselect' : 'Select'}
        onClick={(e) => onPick(e.shiftKey)}
      >
        <Icon name="check" size={14} />
      </button>
    </div>
  );
}

/** A long press with a finger or pen runs `run`; the click that ends it is to be let go (`fired`). */
function useLongPress(run: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touch = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    touch: () => touch.current,
    fired: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        touch.current = e.pointerType !== 'mouse';
        fired.current = false;
        cancel();
        if (!touch.current) return;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          navigator.vibrate?.(10);
          run();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
  };
}

function TileImage({ id, onShape }: { id: string; onShape: (ratio: number) => void }) {
  // Rows up to about 200 points high, twice that on a sharp screen, a wide photo wider.
  const { url } = usePhotoUrl(id, 800);
  if (!url) return <Icon name="image" size={18} />;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (w && h) onShape(w / h);
      }}
    />
  );
}
