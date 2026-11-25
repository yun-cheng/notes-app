import { useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { clipLength, type FileInfo } from '../domain/content';
import { useServices } from '../state/CardsContext';
import { UNREADABLE, usePhotoUrl } from './editor/photo';
import { SealedUnreadable } from '../photos/service';
import { Icon } from './Icon';

/** Where a video plays from: this device's copy, or the server a range at a time (`PhotoService.playAddress`). */
export function useVideoAddress(id: string): { address: string | null; failed: boolean; unreadable?: boolean } {
  const { photos } = useServices();
  const [found, setFound] = useState<{ id: string; address: string | null; failed: boolean; unreadable?: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    photos.playAddress(id).then(
      (address) => live && setFound({ id, address, failed: false }),
      (err: unknown) => live && setFound({ id, address: null, failed: true, unreadable: err instanceof SealedUnreadable }),
    );
    return () => void (live = false);
  }, [photos, id]);
  return found?.id === id ? found : { address: null, failed: false };
}

/** How far a video added here has gone up to the server, from 0 to 1, while it goes in pieces; else null. */
export function useUploadShare(id: string): number | null {
  const { photos } = useServices();
  const { sending } = useSyncExternalStore(photos.subscribe, photos.getState);
  return sending?.id === id ? sending.done : null;
}

/** A play mark over a video's still, with its length when known, as a photo library marks one among photos. */
export function VideoMark({ duration }: { duration?: number | null }) {
  return (
    <span className="video-mark" aria-hidden="true">
      {duration ? clipLength(duration) : null}
      <Icon name="play" size={12} />
    </span>
  );
}

/**
 * A video as a still, for a tile or a thumbnail: the still kept with it, or else the first frame the browser finds in
 * the video itself (fetching only the start), or else a plain mark. `onShape` hears its width over its height.
 */
export function VideoStill({ file, onShape, lazy = false }: { file: FileInfo; onShape?: (ratio: number) => void; lazy?: boolean }) {
  const { url } = usePhotoUrl(file.poster ?? '');
  const { address } = useVideoAddress(file.poster ? '' : file.id);
  useEffect(() => {
    if (file.width && file.height) onShape?.(file.width / file.height);
  }, [file.width, file.height]);
  if (file.poster) {
    return url ? (
      <img
        src={url}
        alt=""
        loading={lazy ? 'lazy' : undefined}
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w && h && !(file.width && file.height)) onShape?.(w / h);
        }}
      />
    ) : (
      <Icon name="video" size={18} />
    );
  }
  return address ? (
    <video
      className="video-still"
      src={`${address}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      disablePictureInPicture
      tabIndex={-1}
      onLoadedMetadata={(e) => {
        const { videoWidth: w, videoHeight: h } = e.currentTarget;
        if (w && h && !(file.width && file.height)) onShape?.(w / h);
      }}
    />
  ) : (
    <Icon name="video" size={18} />
  );
}

/** How long the pointer rests on a video before it plays, so moving across the page doesn't start each one it passes. */
const HOVER_MS = 200;

/**
 * A video playing over its still while the pointer rests on it, muted and over and over, as a photo library previews
 * one: fetched only then, and shown once it plays, so the still stays until it does. Not where motion is turned down.
 */
export function HoverPlay({ file, on }: { file: FileInfo; on: boolean }) {
  const [going, setGoing] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setGoing(false);
    setPlaying(false);
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wait = setTimeout(() => setGoing(true), HOVER_MS);
    return () => clearTimeout(wait);
  }, [on]);
  const { address } = useVideoAddress(going ? file.id : '');
  if (!going || !address) return null;
  return (
    <video
      className={`hover-play${playing ? ' is-playing' : ''}`}
      src={address}
      muted
      loop
      autoPlay
      playsInline
      disablePictureInPicture
      tabIndex={-1}
      aria-hidden="true"
      onPlaying={() => setPlaying(true)}
    />
  );
}

/**
 * A video playing where it is, with the browser's own controls, its still showing until it starts: nothing more, as a
 * photo is shown, save how far it's got while it goes up from this device. A right-click on it offers Download video
 * (`videoAt`, by the ID and name it carries).
 */
export function VideoPlayer({ file, autoPlay = false, className = '' }: { file: FileInfo; autoPlay?: boolean; className?: string }) {
  const { address, failed, unreadable } = useVideoAddress(file.id);
  const { url: poster } = usePhotoUrl(file.poster ?? '');
  const share = useUploadShare(file.id);
  const [broken, setBroken] = useState(false);
  const stop = (e: MouseEvent) => e.stopPropagation();
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : undefined;
  return (
    <span className={`video-player ${className}`} data-video-id={file.id} data-video-name={file.name} data-video-mime={file.mime ?? undefined}>
      {address && !broken ? (
        <video
          className="video-player__video"
          src={address}
          poster={file.poster ? (poster ?? undefined) : undefined}
          controls
          playsInline
          preload="metadata"
          autoPlay={autoPlay}
          style={{ aspectRatio: ratio }}
          onClick={stop}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="video-player__note" style={{ aspectRatio: ratio }}>
          {broken ? "This browser can't play this video. Download it to watch it." : unreadable ? UNREADABLE.video : failed ? 'This video isn’t available offline.' : 'Loading video…'}
        </span>
      )}
      {share !== null && <span className="video-player__sending">Uploading {Math.round(share * 100)}%</span>}
    </span>
  );
}
