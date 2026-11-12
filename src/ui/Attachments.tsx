import { useEffect, useState } from 'react';
import { linkUrls, photoIds, siteName } from '../domain/content';
import type { Card } from '../domain/types';
import { usePhotoUrl } from './editor/photo';
import { Icon } from './Icon';

const MAX_PHOTOS = 4;
const MAX_LINKS = 3;

/** An entry's photos and web links, shown under its bubble: photos as thumbnails, links as small cards. */
export function Attachments({ card }: { card: Card }) {
  const photos = photoIds(card.content);
  const links = linkUrls(card.content);
  const [viewing, setViewing] = useState<number | null>(null);
  if (!photos.length && !links.length) return null;
  const extra = photos.length - MAX_PHOTOS;

  return (
    <div className="attachments">
      {photos.length > 0 && (
        <div className="attachments__photos">
          {photos.slice(0, MAX_PHOTOS).map((id, i) => (
            <button key={id} type="button" className="thumb" aria-label={`Open photo ${i + 1} of ${photos.length}`} onClick={() => setViewing(i)}>
              <Thumb id={id} />
              {i === MAX_PHOTOS - 1 && extra > 0 && <span className="thumb__more">+{extra}</span>}
            </button>
          ))}
        </div>
      )}
      {links.slice(0, MAX_LINKS).map((url) => (
        <LinkCard key={url} url={url} />
      ))}
      {links.length > MAX_LINKS && <span className="attachments__more">and {links.length - MAX_LINKS} more links</span>}
      {viewing !== null && <PhotoViewer ids={photos} start={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  const { url } = usePhotoUrl(id);
  return url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="thumb__empty"><Icon name="image" size={18} /></span>;
}

/** A link as a card with its site, opening in a new tab. */
export function LinkCard({ url }: { url: string }) {
  let path = '';
  try {
    const u = new URL(url);
    path = decodeURI(u.pathname + u.search).replace(/\/$/, '');
  } catch {
    // Shown as typed.
  }
  return (
    <a className="link-card" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <span className="link-card__icon">
        <Icon name="link" size={16} />
      </span>
      <span className="link-card__text">
        <span className="link-card__site">{siteName(url)}</span>
        {path && <span className="link-card__path">{path}</span>}
      </span>
    </a>
  );
}

/** Photos full size, one at a time, with arrows and keys to move between them. */
export function PhotoViewer({ ids, start, onClose }: { ids: string[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const { url, state } = usePhotoUrl(ids[at]);
  const step = (d: number) => setAt((i) => (i + d + ids.length) % ids.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    // Before the sheet's own Escape handler, so Escape closes only the photo.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="dialog-backdrop viewer" role="dialog" aria-label="Photo" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {url ? <img className="viewer__img" src={url} alt={`Photo ${at + 1} of ${ids.length}`} /> : <p className="viewer__note">{state === 'loading' ? 'Loading photo…' : 'This photo isn’t available yet.'}</p>}
      {ids.length > 1 && (
        <>
          <button type="button" className="viewer__nav viewer__nav--prev" aria-label="Previous photo" onClick={() => step(-1)}>
            <Icon name="left" />
          </button>
          <button type="button" className="viewer__nav viewer__nav--next" aria-label="Next photo" onClick={() => step(1)}>
            <Icon name="right" />
          </button>
          <span className="viewer__count">
            {at + 1} / {ids.length}
          </span>
        </>
      )}
      <button type="button" className="viewer__close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
