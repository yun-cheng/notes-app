import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fileAttachments, isVideo, linkUrls, mediaItems, siteName, type FileInfo, type Media } from '../domain/content';
import type { Card } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { usePhotoUrl } from './editor/photo';
import { usePhotoZoom } from './photoZoom';
import { previewFor, useDisplayPrefs } from './displayPrefs';
import { FileChip } from './files';
import { ContextMenu, PhotoItems, Shield, type Point } from './EntryMenu';
import { Icon } from './Icon';
import { useLinkPreview } from './useLinkPreview';
import { useBackdropClose } from './useBackdrop';
import { useCopyPhoto } from './copyPhoto';
import { useInView } from './useInView';
import { VideoMark, VideoPlayer, VideoStill } from './video';

/** The videos among photos and videos, by ID, for the viewer to play. */
export const videosIn = (items: readonly Media[]): ReadonlyMap<string, FileInfo> => new Map(items.flatMap((m) => (m.video ? [[m.id, m.video] as const] : [])));

/** "3 photos", "1 video", "2 photos and 1 video". */
export function mediaCount(items: readonly Media[]): string {
  const videos = items.filter((m) => m.video).length;
  const photos = items.length - videos;
  const say = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
  return photos && videos ? `${say(photos, 'photo')} and ${say(videos, 'video')}` : videos ? say(videos, 'video') : say(photos, 'photo');
}

const MAX_PHOTOS = 4;
const MAX_LINKS = 3;

/**
 * An entry's photos, videos, files and web links, shown under its bubble: photos and videos large, as thumbnails or
 * as a count (a right-click on a photo copies it; a video is marked with its length, and plays full screen); files
 * as chips that open them; links as cards, as one line each or not at all (they stay links in the text). The entry's
 * own style, from its style menu, wins over the device's setting.
 */
export function Attachments({ card }: { card: Card }) {
  const { vaults } = useCards();
  const device = useDisplayPrefs();
  const prefs = previewFor(card.type === 'tag' ? undefined : card.preview, device);
  // Links in an encrypted vault, or in a card from a vault this account can't see, aren't sent anywhere to preview.
  const vault = vaults.find((v) => v.id === card.vaultId);
  const previews = !!vault && !vault.encryption;
  const photos = mediaItems(card.content);
  const files = fileAttachments(card.content).filter((f) => !isVideo(f));
  const links = prefs.links === 'off' ? [] : linkUrls(card.content);
  const [viewing, setViewing] = useState<number | null>(null);
  // A photo right-clicked: a menu to copy it. (The entry's own menu is the bubble's, beside these.)
  const [photoMenu, setPhotoMenu] = useState<{ id: string; at: Point } | null>(null);
  if (!photos.length && !files.length && !links.length) return null;
  const extra = photos.length - MAX_PHOTOS;

  return (
    <div className="attachments">
      {photos.length > 0 && prefs.photos === 'off' && (
        <button type="button" className="attachments__count" onClick={() => setViewing(0)}>
          <Icon name={photos.every((m) => m.video) ? 'video' : 'image'} size={16} />
          {mediaCount(photos)}
        </button>
      )}
      {photos.length > 0 && prefs.photos !== 'off' && (
        <div className={`attachments__photos${prefs.photos === 'large' ? ' attachments__photos--large' : ''}`}>
          {photos.slice(0, MAX_PHOTOS).map(({ id, video }, i) => (
            <button
              key={id}
              type="button"
              className={`thumb${video ? ' thumb--video' : ''}`}
              data-photo-id={id}
              aria-label={`Open ${video ? 'video' : 'photo'} ${i + 1} of ${photos.length}`}
              onClick={() => setViewing(i)}
              onContextMenu={(e) => {
                // Shift keeps the browser's menu.
                if (e.shiftKey) return;
                e.preventDefault();
                if (!video) setPhotoMenu({ id, at: { x: e.clientX, y: e.clientY } });
              }}
            >
              {video ? <VideoStill file={video} lazy /> : <Thumb id={id} />}
              {video && !(i === MAX_PHOTOS - 1 && extra > 0) && <VideoMark duration={video.duration} />}
              {i === MAX_PHOTOS - 1 && extra > 0 && <span className="thumb__more">+{extra}</span>}
            </button>
          ))}
        </div>
      )}
      {files.map((file) => (
        <FileChip key={file.id} file={file} />
      ))}
      {links.slice(0, MAX_LINKS).map((url) => (
        <LinkCard key={url} url={url} preview={previews} compact={prefs.links === 'compact'} />
      ))}
      {links.length > MAX_LINKS && <span className="attachments__more">and {links.length - MAX_LINKS} more links</span>}
      {viewing !== null && <PhotoViewer ids={photos.map((m) => m.id)} videos={videosIn(photos)} start={viewing} onClose={() => setViewing(null)} />}
      {photoMenu && <PhotoMenu id={photoMenu.id} at={photoMenu.at} onClose={() => setPhotoMenu(null)} />}
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  const { url } = usePhotoUrl(id);
  return url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="thumb__empty"><Icon name="image" size={18} /></span>;
}

/**
 * A link as a card opening in a new tab: the page's own title, description and image when it can be previewed,
 * or else its site and path. The image loads from the page's site, with no referrer. With `address`, its whole
 * address shows under it in place of the site, as the Links page has it.
 */
export function LinkCard({ url, preview: allowed, compact = false, address = false }: { url: string; preview: boolean; compact?: boolean; address?: boolean }) {
  const preview = useLinkPreview(url, allowed);
  const [imageFailed, setImageFailed] = useState(false);
  let path = '';
  let whole = url;
  try {
    const u = new URL(url);
    path = decodeURI(u.pathname + u.search).replace(/\/$/, '');
    whole = decodeURI(url);
  } catch {
    // Shown as typed.
  }
  if (compact) {
    return (
      <a className="link-card link-card--compact" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={url}>
        <Icon name="link" size={14} />
        <span className="link-card__title">{preview?.title ?? (path ? `${siteName(url)}${path}` : siteName(url))}</span>
        {preview?.title && <span className="link-card__site">{preview.site ?? siteName(url)}</span>}
      </a>
    );
  }
  return (
    <a className={`link-card${preview?.title ? ' link-card--rich' : ''}`} href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      {preview?.image && !imageFailed ? (
        <img className="link-card__image" src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      ) : (
        <span className="link-card__icon">
          <Icon name="link" size={16} />
        </span>
      )}
      <span className="link-card__text">
        {preview?.title && <span className="link-card__title">{preview.title}</span>}
        {preview?.description && <span className="link-card__desc">{preview.description}</span>}
        {(!address || !preview?.title) && <span className="link-card__site">{preview?.site ?? siteName(url)}</span>}
        {address ? <span className="link-card__address">{whole}</span> : path && !preview?.title && <span className="link-card__path">{path}</span>}
      </span>
    </a>
  );
}

/**
 * Photos and videos full size, one at a time (a video, among `videos`, playing), with arrows and keys to move between them, and, for more than one, a row of them
 * all along the bottom, the one shown marked and kept in sight, any of them pressed to show it. Each zooms with the
 * wheel or a pinch (`usePhotoZoom`), and Cmd+C (Ctrl+C) copies the one shown. `caption` puts something about the
 * photo shown above the row. A right-click opens a menu to copy the photo, or `onMenu`'s instead: on the Photos
 * page, its entry and what to do with it, as well.
 */
export function PhotoViewer({
  ids,
  videos,
  start,
  onClose,
  caption,
  onMenu,
}: {
  ids: string[];
  videos?: ReadonlyMap<string, FileInfo>;
  start: number;
  onClose: () => void;
  caption?: (at: number) => ReactNode;
  onMenu?: (at: number, point: Point) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [at, setAt] = useState(start);
  const video = videos?.get(ids[at]);
  // A video isn't fetched whole: it plays a range at a time.
  const { url, state } = usePhotoUrl(video ? '' : ids[at]);
  const step = (d: number) => setAt((i) => (i + d + ids.length) % ids.length);
  const zoom = usePhotoZoom(ids[at]);
  const copyPhoto = useCopyPhoto();
  const [menu, setMenu] = useState<Point | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu open over the photo takes the keys: Escape closes it alone.
      if (document.querySelector('.context-menu')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (video) return;
      else if (e.key === '+' || e.key === '=') zoom.zoomIn();
      else if (e.key === '-') zoom.zoomOut();
      else if (e.key === '0') zoom.fit();
      else if (e.key === 'c' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !window.getSelection()?.toString()) {
        // The photo alone: not the entries picked under the viewer too.
        e.preventDefault();
        e.stopPropagation();
        copyPhoto(ids[at]);
      }
    };
    // Before the sheet's own Escape handler, so Escape closes only the photo.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div ref={zoom.area} className={`dialog-backdrop viewer${ids.length > 1 ? ' viewer--strip' : ''}`} role="dialog" aria-label={video ? 'Video' : 'Photo'} {...backdrop}>
      {video ? (
        <span
          className="viewer__video"
          onContextMenu={(e) => {
            if (e.shiftKey || !onMenu) return;
            e.preventDefault();
            e.stopPropagation();
            onMenu(at, { x: e.clientX, y: e.clientY });
          }}
        >
          <VideoPlayer key={ids[at]} file={video} autoPlay />
        </span>
      ) : url ? (
        <img
          className="viewer__img"
          src={url}
          alt={`Photo ${at + 1} of ${ids.length}`}
          {...zoom.image}
          onContextMenu={(e) => {
            // Shift keeps the browser's menu, to save the photo, say.
            if (e.shiftKey) return;
            e.preventDefault();
            // Not the entry's menu, for the bubble the viewer opened from.
            e.stopPropagation();
            const point = { x: e.clientX, y: e.clientY };
            if (onMenu) onMenu(at, point);
            else setMenu(point);
          }}
        />
      ) : (
        <p className="viewer__note">{state === 'loading' ? 'Loading photo…' : 'This photo isn’t available yet.'}</p>
      )}
      {!video && zoom.zoom.scale > 1 && (
        <button type="button" className="viewer__fit" title="Fit the photo to the screen (0)" onClick={zoom.fit}>
          {Math.round(zoom.zoom.scale * 100)}% · Fit
        </button>
      )}
      {caption?.(at)}
      {ids.length > 1 && (
        <>
          <button type="button" className="viewer__nav viewer__nav--prev" aria-label="Previous" onClick={() => step(-1)}>
            <Icon name="left" />
          </button>
          <button type="button" className="viewer__nav viewer__nav--next" aria-label="Next" onClick={() => step(1)}>
            <Icon name="right" />
          </button>
          <span className="viewer__count">
            {at + 1} / {ids.length}
          </span>
          <div className="viewer__strip" role="group" aria-label="All of them">
            {ids.map((id, i) => (
              <StripThumb key={id} id={id} video={videos?.get(id)} label={`${videos?.has(id) ? 'Video' : 'Photo'} ${i + 1} of ${ids.length}`} current={i === at} onPick={() => setAt(i)} />
            ))}
          </div>
        </>
      )}
      <button type="button" className="viewer__close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {menu && <PhotoMenu id={ids[at]} at={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** A photo's own menu, on a right-click: copy it. */
function PhotoMenu({ id, at, onClose }: { id: string; at: Point; onClose: () => void }) {
  return createPortal(
    <Shield>
      <ContextMenu at={at} label="Photo" onClose={onClose}>
        <PhotoItems id={id} onClose={onClose} />
      </ContextMenu>
    </Shield>,
    document.body,
  );
}

/**
 * One photo in the viewer's bottom row, whole, at the row's height; the one shown scrolls into the middle of the row.
 * It loads once it's near sight in the row, which can hold every photo there is.
 */
function StripThumb({ id, video, label, current, onPick }: { id: string; video?: FileInfo; label: string; current: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const seen = useInView(ref, '0px 400px', true);
  useEffect(() => {
    const el = ref.current;
    const row = el?.parentElement;
    // The row alone scrolls (it's what the thumbnail is placed in), not the page under the viewer.
    if (!current || !el || !row) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollTo({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2, behavior: still ? 'auto' : 'smooth' });
  }, [current]);
  return (
    <button ref={ref} type="button" className={`viewer__thumb${current ? ' is-current' : ''}`} aria-label={label} aria-current={current || undefined} onClick={onPick}>
      {seen || current ? video ? <VideoStill file={video} /> : <StripImage id={id} /> : <Icon name={video ? 'video' : 'image'} size={16} />}
      {video && <VideoMark />}
    </button>
  );
}

function StripImage({ id }: { id: string }) {
  const { url } = usePhotoUrl(id);
  return url ? <img src={url} alt="" draggable={false} /> : <Icon name="image" size={16} />;
}
