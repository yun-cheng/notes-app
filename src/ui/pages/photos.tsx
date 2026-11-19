import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { displayTitle } from '../../domain/content';
import { relativeDay } from '../../domain/dates';
import { layoutPhotos, photoDays, type Box, type PhotoItem } from '../../domain/photos';
import { entryMatcher, filterParams, isFiltered } from '../../domain/stream';
import { useCards, useToday } from '../../state/CardsContext';
import { PhotoViewer } from '../Attachments';
import { Empty, Page } from '../components';
import { usePhotoUrl } from '../editor/photo';
import { FilterBar, FilterSheet, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { cardPath, sheetState } from '../paths';
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
        onClick={() => {
          setViewing(null);
          void navigate(cardPath(card), { state: sheetState(location, card) });
        }}
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
                      <Tile key={item.id} item={item} box={layout.tiles[d][i]} onShape={onShape} onOpen={() => setViewing(first + i)} />
                    ))}
                  </section>
                );
              })}
          </div>
        </div>
      )}
      {viewing !== null && <PhotoViewer ids={all.map((i) => i.id)} start={viewing} onClose={() => setViewing(null)} caption={caption} />}
    </Page>
  );
}

/** A photo in the layout, at its place; it loads once it's near the screen. */
function Tile({ item, box, onShape, onOpen }: { item: PhotoItem; box: Box; onShape: (id: string, ratio: number) => void; onOpen: () => void }) {
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
