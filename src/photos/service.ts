import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import type { PhotoStore, PhotoTransport, PreparedPhoto } from './types';

export type PhotoProblem = 'needs_drive' | 'not_configured' | 'offline' | 'error' | null;

export interface PhotoState {
  /** Photos added on this device that the server doesn't have yet. */
  pending: number;
  /** Why uploading is stuck, if it is. */
  problem: PhotoProblem;
}

const RETRY_MS = 60_000;

/**
 * Photos are saved on the device first and uploaded in the background, so adding one works
 * offline. A photo from another device is fetched once and then kept here.
 */
export class PhotoService {
  private state: PhotoState = { pending: 0, problem: null };
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

  /** The photo itself, from this device or else the server. Null if the server doesn't have it yet. */
  async blob(id: string): Promise<Blob | null> {
    const local = await this.store.getPhoto(id);
    if (local) return local.blob;
    const blob = await this.transport.download(id);
    if (blob) await this.store.putPhoto({ id, vaultId: '', blob, mime: blob.type, width: null, height: null, uploaded: 1, addedAt: this.now() });
    return blob;
  }

  /** An object URL for showing the photo, shared by every view of it. */
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
        const result = await this.transport.upload(photo);
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
        problem = err instanceof SyncOffline ? 'offline' : err instanceof SyncAuthExpired ? 'offline' : 'error';
        if (problem === 'offline') break;
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
