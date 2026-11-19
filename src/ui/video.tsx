import { useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { clipLength, type FileInfo } from '../domain/content';
import { useCards } from '../state/CardsContext';
import { usePhotoUrl } from './editor/photo';
import { fileKind, useFileActions } from './files';
import { fileSize } from '../photos/service';
import { Icon } from './Icon';

/** Where a video plays from: this device's copy, or the server a range at a time (`PhotoService.playAddress`). */
export function useVideoAddress(id: string): { address: string | null; failed: boolean } {
  const { photos } = useCards();
  const [found, setFound] = useState<{ id: string; address: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    photos.playAddress(id).then(
      (address) => live && setFound({ id, address, failed: false }),
      () => live && setFound({ id, address: null, failed: true }),
    );
    return () => void (live = false);
  }, [photos, id]);
  return found?.id === id ? found : { address: null, failed: false };
}

/** How far a video added here has gone up to the server, from 0 to 1, while it goes in pieces; else null. */
export function useUploadShare(id: string): number | null {
  const { photos } = useCards();
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

/**
 * A video playing where it is, with the browser's own controls, its still showing until it starts. Under it, its name,
 * size and kind, and a button to download it; while it goes up from this device, how far it's got.
 */
export function VideoPlayer({ file, autoPlay = false, className = '' }: { file: FileInfo; autoPlay?: boolean; className?: string }) {
  const { address, failed } = useVideoAddress(file.id);
  const { url: poster } = usePhotoUrl(file.poster ?? '');
  const act = useFileActions();
  const share = useUploadShare(file.id);
  const [broken, setBroken] = useState(false);
  const stop = (e: MouseEvent) => e.stopPropagation();
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : undefined;
  const detail = [file.duration ? clipLength(file.duration) : null, file.size !== null ? fileSize(file.size) : null, fileKind(file.name)].filter(Boolean).join(' · ');
  return (
    <span className={`video-player ${className}`}>
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
          {broken ? "This browser can't play this video. Download it to watch it." : failed ? 'This video isn’t available offline.' : 'Loading video…'}
        </span>
      )}
      <span className="video-player__bar">
        <Icon name="video" size={14} />
        <span className="video-player__name" title={file.name}>
          {file.name}
        </span>
        <span className="video-player__detail">{share !== null ? `Uploading ${Math.round(share * 100)}%` : detail}</span>
        <button type="button" className="icon-btn video-player__save" aria-label={`Download ${file.name}`} title="Download" onClick={(e) => (stop(e), void act(file, true))}>
          <Icon name="download" size={16} />
        </button>
      </span>
    </span>
  );
}
