import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { posterId } from '../domain/content';
import type { PhotoStore, PhotoTransport, PreparedPhoto, VideoFacts } from './types';
import { videoType } from './video';

export type PhotoProblem = 'needs_drive' | 'not_configured' | 'offline' | 'expired' | 'error' | null;

export interface PhotoState {
  /** Photos added on this device that the server doesn't have yet. */
  pending: number;
  /** Why uploading is stuck, if it is. */
  problem: PhotoProblem;
  /** A big one going up in pieces now, and how far along it is, from 0 to 1. */
  sending: { id: string; done: number } | null;
}

/** What a video's block keeps (`FileInfo`). */
export interface VideoAttrs {
  id: string;
  name: string;
  mime: string;
  size: number;
  poster: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

const RETRY_MS = 60_000;
/** The largest file the server takes (MAX_FILE_BYTES there), and the largest video (MAX_VIDEO_BYTES). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const NOTHING_KNOWN: VideoFacts = { poster: null, width: null, height: null, duration: null };

/** A file's size for people: "820 KB", "3.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Photos are saved on the device first and uploaded in the background, so adding one works
 * offline. A photo from another device is fetched once and then kept here.
 */
export class PhotoService {
  private state: PhotoState = { pending: 0, problem: null, sending: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private urls = new Map<string, Promise<string | null>>();

  constructor(
    private store: PhotoStore,
    private transport: PhotoTransport,
    private prepare: (file: Blob) => Promise<PreparedPhoto>,
    private newId: () => string = () => crypto.randomUUID(),
    private now: () => number = Date.now,
    private probe: (file: Blob) => Promise<VideoFacts> = async () => NOTHING_KNOWN,
  ) {}

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private publish(change: Partial<PhotoState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((l) => l());
  }

  /** Shrinks and saves a photo for a card in `vaultId`, and returns its ID right away. */
  async add(file: Blob, vaultId: string): Promise<string> {
    const prepared = await this.prepare(file);
    const id = this.newId();
    await this.store.putPhoto({ id, vaultId, ...prepared, uploaded: 0, addedAt: this.now() });
    this.publish({ pending: this.state.pending + 1 });
    void this.upload();
    return id;
  }

  /**
   * Saves a file of any kind for a card in `vaultId`, as it is, and returns what its block keeps: with a sound's
   * length in seconds, when known. Throws, saying why, for one too big to upload.
   */
  async addFile(file: File, vaultId: string, duration: number | null = null): Promise<{ id: string; name: string; mime: string; size: number; duration?: number }> {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name || 'That file'} is ${fileSize(file.size)}. Files can be up to ${fileSize(MAX_FILE_BYTES)}.`);
    if (!file.size) throw new Error(`${file.name || 'That file'} is empty.`);
    const id = this.newId();
    const name = file.name || 'Untitled';
    // Without what a recorder adds to its type ("audio/webm;codecs=opus").
    const mime = file.type.split(';')[0].trim() || 'application/octet-stream';
    await this.store.putPhoto({ id, vaultId, file: { name }, blob: file, mime, width: null, height: null, ...(duration ? { duration } : {}), uploaded: 0, addedAt: this.now() });
    this.publish({ pending: this.state.pending + 1 });
    void this.upload();
    return { id, name, mime, size: file.size, ...(duration ? { duration } : {}) };
  }

  /**
   * Saves a video for a card in `vaultId`, as it is, with a still from it (a photo of its own, `posterId`) when this
   * browser can read it, and returns what its block keeps. Throws, saying why, for one too big to upload.
   */
  async addVideo(file: File, vaultId: string): Promise<VideoAttrs> {
    const name = file.name || 'Video';
    if (file.size > MAX_VIDEO_BYTES) throw new Error(`${name} is ${fileSize(file.size)}. Videos can be up to ${fileSize(MAX_VIDEO_BYTES)}.`);
    if (!file.size) throw new Error(`${name} is empty.`);
    const facts = await this.probe(file).catch(() => NOTHING_KNOWN);
    const id = this.newId();
    const mime = videoType(file);
    const at = this.now();
    let poster: string | null = null;
    let added = 1;
    if (facts.poster) {
      const prepared = await this.prepare(facts.poster).catch(() => null);
      if (prepared) {
        poster = posterId(id);
        await this.store.putPhoto({ id: poster, vaultId, ...prepared, uploaded: 0, addedAt: at });
        added++;
      }
    }
    await this.store.putPhoto({ id, vaultId, file: { name }, blob: file, mime, width: facts.width, height: facts.height, duration: facts.duration, uploaded: 0, addedAt: at + 1 });
    this.publish({ pending: this.state.pending + added });
    void this.upload();
    return { id, name, mime, size: file.size, poster, width: facts.width, height: facts.height, duration: facts.duration };
  }

  /**
   * Where a video plays from: this device's copy when it has one (added here, or fetched whole before), else the
   * server, a range at a time, so a long one starts at once and isn't kept whole on every device.
   */
  async playAddress(id: string): Promise<string | null> {
    if ((await this.store.getPhoto(id)) || !this.transport.address) return this.url(id);
    return this.transport.address(id);
  }

  /** The photo or file itself, from this device or else the server. Null if the server doesn't have it yet. */
  async blob(id: string): Promise<Blob | null> {
    const local = await this.store.getPhoto(id);
    if (local) return local.blob;
    const blob = await this.transport.download(id);
    if (blob) await this.store.putPhoto({ id, vaultId: '', blob, mime: blob.type, width: null, height: null, uploaded: 1, addedAt: this.now() });
    return blob;
  }

  /** An object URL for showing the photo, or opening the file, shared by every view of it. */
  url(id: string): Promise<string | null> {
    let url = this.urls.get(id);
    if (!url) {
      url = this.blob(id).then(
        (blob) => {
          if (!blob) this.urls.delete(id);
          return blob ? URL.createObjectURL(blob) : null;
        },
        (err: unknown) => {
          this.urls.delete(id);
          throw err;
        },
      );
      this.urls.set(id, url);
    }
    return url;
  }

  /** Forgets a photo or file deleted for good: this device's copy, and any address made to show it. */
  async forget(id: string): Promise<void> {
    const url = this.urls.get(id);
    this.urls.delete(id);
    void url?.then((u) => u && URL.revokeObjectURL(u), () => undefined);
    await this.store.deletePhoto(id);
  }

  /** Uploads waiting photos, oldest first. Stops at the first problem that would stop the rest too. */
  upload(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.uploadOnce();
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async uploadOnce() {
    const pending = await this.store.pendingPhotos();
    let problem: PhotoProblem = null;
    let left = pending.length;
    for (const photo of pending) {
      try {
        const result = await this.transport.upload(photo, (done) => this.publish({ sending: { id: photo.id, done } }));
        if (this.state.sending) this.publish({ sending: null });
        if (result === 'ok') {
          await this.store.markPhotoUploaded(photo.id);
          left--;
          continue;
        }
        if (result === 'rejected') {
          problem = 'error';
          continue;
        }
        problem = result;
        break;
      } catch (err) {
        if (this.state.sending) this.publish({ sending: null });
        problem = err instanceof SyncOffline ? 'offline' : err instanceof SyncAuthExpired ? 'expired' : 'error';
        if (problem !== 'error') break;
        console.error('Photo upload failed', err);
      }
    }
    this.publish({ pending: left, problem: left ? problem : null });
  }

  /** Uploads now, when the connection returns, on return to the app, and every minute while some wait. */
  start(): () => void {
    const run = () => void this.upload();
    const onVisible = () => document.visibilityState === 'visible' && run();
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (this.state.pending && document.visibilityState === 'visible') run();
    }, RETRY_MS);
    run();
    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }
}
