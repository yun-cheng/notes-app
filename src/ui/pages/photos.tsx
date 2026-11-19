import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { displayTitle } from '../../domain/content';
import { relativeDay } from '../../domain/dates';
import { layoutPhotos, photoDays, type Box, type PhotoItem } from '../../domain/photos';
import { entryMatcher, filterParams, isFiltered } from '../../domain/stream';
import { useCards, useToday } from '../../state/CardsContext';
import { PhotoViewer } from '../Attachments';
import { Empty, Page } from '../components';
import { ContextMenu, Item, Shield, type Point } from '../EntryMenu';
import { usePhotoUrl } from '../editor/photo';
import { FilterBar, FilterSheet, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { cardPath, sheetState } from '../paths';
import { useShowInJournal } from '../showInJournal';
import { useInView } from '../useInView';

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
 * Every photo in the journal, newest first, under the day its entry was written, laid out as a photo library does:
 * whole, in rows of about one height that fill the width, a day with a few beside the day before (`layoutPhotos`).
 * A photo opens full screen, where all of them page past in turn, each naming its entry, which opens from there.
 * The journal's filters narrow it: one tag's photos, one vault's, or those in todos. Photos load as they come near.
 */
export function PhotosPage() {
  const { index, sharedInto } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const key = filterParams(filter).toString();
  const days = useMemo(() => {
    const keep = entryMatcher(filter, today, sharedInto);
    return photoDays(index.live.filter((c) => (c.type === 'note' || c.type === 'todo') && !c.archived && !c.template && keep(c)));
    // The filter by what it says, not which object it is.
  }, [index, key, today, sharedInto]);
  const all = useMemo(() => days.flatMap((d) => d.items), [days]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [filtering, setFiltering] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const entries = new Set(all.map((i) => i.card.id)).size;
  const showInJournal = useShowInJournal();
  // A photo right-clicked, in the grid or full screen: its entry, to open or go to.
  const [menu, setMenu] = useState<{ at: number; point: Point } | null>(null);
  const openEntry = (item: PhotoItem) => {
    setViewing(null);
    void navigate(cardPath(item.card), { state: sheetState(location, item.card) });
  };

  // The width to fill, and a count of shapes learned, each a new layout.
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [learned, setLearned] = useState(0);
  const any = all.length > 0;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, [any]);
  const layout = useMemo(
    () => (width ? layoutPhotos(days.map((d) => d.items.map((i) => shapes.get(i.id) ?? 1)), sizes(width)) : null),
    [days, width, learned],
  );
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

  let n = 0;
  return (
    <Page
      title="Photos"
      actions={
        <button type="button" className={`icon-btn only-mobile${filter.tagId || filter.vaultId ? ' is-active' : ''}`} aria-label="Tags and vaults" title="Tags and vaults" onClick={() => setFiltering(true)}>
          <Icon name="filter" />
        </button>
      }
      below={<FilterBar filter={filter} />}
    >
      {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
      {!all.length ? (
        <Empty>{isFiltered(filter) ? 'No photos here match. Take a filter off above, or pick another.' : 'No photos yet. Add one to an entry with its photo button, or paste or drop one in.'}</Empty>
      ) : (
        <div className="photos">
          <p className="photos__count">
            {all.length === 1 ? '1 photo' : `${all.length} photos`}, in {entries === 1 ? '1 entry' : `${entries} entries`}
          </p>
          <div className="photos__canvas" ref={canvas} style={{ height: layout?.height }}>
            {layout &&
              days.map(({ day, items }, d) => {
                const first = n;
                n += items.length;
                const head = layout.heads[d];
                return (
                  <section key={day} className="photos__daygroup" aria-label={relativeDay(day, today)}>
                    <h2 className="photos__day" style={{ left: head.x, top: head.y, width: head.w, height: head.h }}>
                      {relativeDay(day, today)}
                    </h2>
                    {items.map((item, i) => (
                      <Tile
                        key={item.id}
                        item={item}
                        box={layout.tiles[d][i]}
                        onShape={onShape}
                        onOpen={() => setViewing(first + i)}
                        onMenu={(point) => setMenu({ at: first + i, point })}
                      />
                    ))}
                  </section>
                );
              })}
          </div>
        </div>
      )}
      {viewing !== null && (
        <PhotoViewer ids={all.map((i) => i.id)} start={viewing} onClose={() => setViewing(null)} caption={caption} onMenu={(at, point) => setMenu({ at, point })} />
      )}
      {menu &&
        all[menu.at] &&
        createPortal(
          <Shield>
            <PhotoMenu
              item={all[menu.at]}
              at={menu.point}
              onView={viewing === null ? () => setViewing(menu.at) : undefined}
              onOpen={() => openEntry(all[menu.at])}
              onShow={() => showInJournal(all[menu.at].card)}
              onClose={() => setMenu(null)}
            />
          </Shield>,
          document.body,
        )}
    </Page>
  );
}

/**
 * A photo's menu, on a right-click: its entry named, opened over the page or gone to in the journal, and the photo
 * full screen when it isn't already.
 */
function PhotoMenu({ item, at, onView, onOpen, onShow, onClose }: { item: PhotoItem; at: Point; onView?: () => void; onOpen: () => void; onShow: () => void; onClose: () => void }) {
  const today = useToday();
  const run = (work: () => void) => () => {
    onClose();
    work();
  };
  return (
    <ContextMenu at={at} label="Photo" onClose={onClose}>
      <span className="context-menu__head">
        <span className="context-menu__head-title">{displayTitle(item.card) || 'Untitled'}</span>
        <span>{relativeDay(item.day, today)}</span>
      </span>
      <div className="style-menu__group">
        {onView && (
          <Item icon="image" onClick={run(onView)}>
            View photo
          </Item>
        )}
        <Item icon="open" onClick={run(onOpen)}>
          Open entry
        </Item>
        <Item icon="notes" onClick={run(onShow)}>
          Show in journal
        </Item>
      </div>
      <span className="context-menu__note">Shift-right-click for the browser's menu</span>
    </ContextMenu>
  );
}

/** A photo in the layout, at its place; it loads once it's near the screen. A right-click opens its menu. */
function Tile({ item, box, onShape, onOpen, onMenu }: { item: PhotoItem; box: Box; onShape: (id: string, ratio: number) => void; onOpen: () => void; onMenu: (at: Point) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const seen = useInView(ref, '600px 0px');
  return (
    <button
      ref={ref}
      type="button"
      className="photo-tile"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      aria-label={`Photo in ${displayTitle(item.card) || 'Untitled'}`}
      onClick={onOpen}
      onContextMenu={(e: MouseEvent) => {
        // Shift keeps the browser's menu, to save the photo, say.
        if (e.shiftKey) return;
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {seen && <TileImage id={item.id} onShape={(r) => onShape(item.id, r)} />}
    </button>
  );
}

function TileImage({ id, onShape }: { id: string; onShape: (ratio: number) => void }) {
  const { url } = usePhotoUrl(id);
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
