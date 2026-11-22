import { HEADER_BYTES, openAttachment, readHeader, sealAttachment, sealedFacts, sealedVault, type SealedFacts } from '../crypto/attachmentSeal';
import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { posterId } from '../domain/content';
import type { PhotoRecord, PhotoStore, PhotoTransport, PreparedPhoto, VideoFacts } from './types';
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
const SEALED_TYPE = 'application/octet-stream';

/**
 * Said of a file this browser isn't allowed to read. A picture copied in an app that keeps its files to itself, as
 * Telegram does on a Mac, comes to the page only as that app's file, which macOS won't let the browser open, and
 * there's nothing else on the clipboard to take instead. Without this, saving it failed as "DataError Failed to write
 * blobs (IOError)".
 */
export const UNREADABLE = 'This browser isn’t allowed to read that file, as with a picture copied in an app that keeps its files to itself (Telegram on a Mac does). Save it to a folder first, then add it from there.';

/** Throws, saying why, for a file the browser can't read: picked, pasted or dropped from somewhere it may not open. */
async function mustRead(blob: Blob): Promise<void> {
  try {
    await blob.slice(0, 1).arrayBuffer();
  } catch {
    throw new Error(UNREADABLE);
  }
}
/**
 * The largest fetched from the server that's kept on this device. A longer video plays from the server each time,
 * as one not sealed streams, rather than filling the device's storage: a sealed one is fetched whole each time.
 */
export const KEEP_BYTES = 64 * 1024 * 1024;

/** The vault keys open on this device (the `Keyring`), to seal what's added to an encrypted vault and open it again. */
export interface VaultKeys {
  isEncrypted(vaultId: string): boolean;
  key(vaultId: string): CryptoKey | undefined;
  /** Whether any of the account's vaults is encrypted: until one is, nothing on the server is sealed. */
  anyEncrypted(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Thrown adding to an encrypted vault that isn't open here, as what's added to it is sealed with its key. */
export class VaultClosed extends Error {}

/** Thrown showing a sealed one its vault's key doesn't open: damaged, or sealed with another key. Asking again won't help. */
export class SealedUnreadable extends Error {}

/** A file's size for people: "820 KB", "3.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Why a file can't be attached as it is (too big to upload, or empty), or null when it can. */
export function fileProblem(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return `${file.name || 'That file'} is ${fileSize(file.size)}. Files can be up to ${fileSize(MAX_FILE_BYTES)}.`;
  if (!file.size) return `${file.name || 'That file'} is empty.`;
  return null;
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
  /** Shrunk copies for thumbnails, by ID and size, the least recently asked for let go past `MAX_THUMBS`. */
  private thumbs = new Map<string, Promise<string | null>>();
  /** The vault each sealed one shown here is in, so it stops showing once that vault locks. */
  private opened = new Map<string, string>();
  /** Whether each the server has is sealed, from the server's list or else its start. */
  private sealedThere = new Map<string, boolean>();
  /** The start of each fetched from the server, which never changes, so the Trash refreshing fetches none again. */
  private starts = new Map<string, Uint8Array>();

  constructor(
    private store: PhotoStore,
    private transport: PhotoTransport,
    private prepare: (file: Blob) => Promise<PreparedPhoto>,
    private newId: () => string = () => crypto.randomUUID(),
    private now: () => number = Date.now,
    private probe: (file: Blob) => Promise<VideoFacts> = async () => NOTHING_KNOWN,
    private keys: VaultKeys | null = null,
  ) {
    keys?.subscribe(() => this.dropLocked());
  }

  /** Forgets the addresses of sealed ones whose vault is locked now, so nothing of a locked vault stays readable in memory. */
  private dropLocked() {
    for (const [id, vaultId] of this.opened) {
      if (this.keys?.key(vaultId)) continue;
      this.opened.delete(id);
      const url = this.urls.get(id);
      this.urls.delete(id);
      void url?.then((u) => u && URL.revokeObjectURL(u), () => undefined);
      this.dropThumbs(id);
    }
  }

  private dropThumbs(id?: string) {
    for (const [key, url] of this.thumbs) {
      if (id !== undefined && !key.startsWith(`${id}@`)) continue;
      this.thumbs.delete(key);
      void url.then((u) => u && URL.revokeObjectURL(u), () => undefined);
    }
  }

  /**
   * Keeps one added here, to upload: sealed with its vault's key when that vault is encrypted, so neither this
   * device's storage nor the server holds it readable. Its name, type and shape go in the seal.
   */
  private async keep(record: PhotoRecord, facts: Omit<SealedFacts, 'size'>, seal = !!this.keys?.isEncrypted(record.vaultId)): Promise<void> {
    await mustRead(record.blob);
    if (!seal) return this.store.putPhoto(record);
    const key = this.keys?.key(record.vaultId);
    if (!key) throw new VaultClosed('Open the vault first.');
    const blob = await sealAttachment(key, record.blob, record.id, record.vaultId, facts);
    await this.store.putPhoto({ id: record.id, vaultId: record.vaultId, blob, mime: SEALED_TYPE, width: null, height: null, sealed: 1, uploaded: 0, addedAt: record.addedAt });
  }

  /**
   * A sealed one opened with its vault's key, with what it says of itself; one not sealed as it is. Null while that
   * vault is locked here; `SealedUnreadable` if its key doesn't open it.
   */
  private async open(blob: Blob, id: string): Promise<{ blob: Blob; facts: SealedFacts | null } | null> {
    const vaultId = await sealedVault(blob);
    if (!vaultId) return { blob, facts: null };
    const key = this.keys?.key(vaultId);
    if (!key) return null;
    const opened = await openAttachment(key, blob, id);
    // Locked while it was being opened: it isn't shown, or kept in memory.
    if (!this.keys?.key(vaultId)) return null;
    if (!opened) throw new SealedUnreadable(`Attachment ${id} doesn't open with its vault's key.`);
    this.opened.set(id, vaultId);
    return opened;
  }

  /** This device's copy, as kept: sealed, for one in an encrypted vault. */
  local = (id: string) => this.store.getPhoto(id);

  /**
   * Copies a photo or file under a new ID for `vaultId`, sealed or not as `seal` says, to replace it in its entries
   * when its vault starts or stops being encrypted: the server keeps one as it came, so the old can't become the
   * new. `facts` are what its block says of it (a file's name and type, a video's shape and length); a sealed one
   * says the rest itself. False when it can't be had now: not on the server yet, offline, or sealed in a vault
   * locked here.
   */
  async copyAs(id: string, by: string, vaultId: string, seal: boolean, facts: { file: boolean } & Partial<Omit<SealedFacts, 'size'>>): Promise<boolean> {
    const local = await this.store.getPhoto(id);
    const raw = local?.blob ?? (await this.transport.download(id).catch(() => null));
    const opened = raw && (await this.open(raw, id).catch(() => null));
    if (!opened) return false;
    const { blob } = opened;
    const told: Partial<SealedFacts> = opened.facts ?? (local ? { mime: local.mime, name: local.file?.name, width: local.width, height: local.height, duration: local.duration } : {});
    const mime = facts.mime || told.mime || blob.type || SEALED_TYPE;
    const name = facts.name ?? told.name ?? 'Untitled';
    const shape = { width: facts.width ?? told.width ?? null, height: facts.height ?? told.height ?? null, duration: facts.duration ?? told.duration ?? null };
    await this.keep(
      { id: by, vaultId, ...(facts.file ? { file: { name } } : {}), blob, mime, ...shape, uploaded: 0, addedAt: this.now() },
      { mime, ...(facts.file ? { name } : {}), ...shape },
      seal,
    );
    this.publish({ pending: this.state.pending + 1 });
    void this.upload();
    return true;
  }

  /** Notes which of the server's are sealed (`GET /attachments`), so a video's start needn't be fetched to tell. */
  learn(stored: readonly { id: string; sealed?: number }[]) {
    for (const a of stored) this.sealedThere.set(a.id, !!a.sealed);
  }

  /**
   * Whether one the server has, and this device doesn't, is sealed: from the server's list, or else its first bytes.
   * Only an answer the server gave is kept: offline, or not uploaded yet, it's asked again next time.
   */
  private async isSealedThere(id: string): Promise<boolean> {
    if (!this.keys?.anyEncrypted() || !this.transport.start) return false;
    const known = this.sealedThere.get(id);
    if (known !== undefined) return known;
    const start = await this.startThere(id);
    if (!start) return false;
    const sealed = !!readHeader(start);
    this.sealedThere.set(id, sealed);
    return sealed;
  }

  /** One's first bytes on the server, enough for its header, fetched once; null when the server didn't answer, to ask again. */
  private async startThere(id: string): Promise<Uint8Array | null> {
    const known = this.starts.get(id);
    if (known) return known;
    const start = (await this.transport.start?.(id, HEADER_BYTES).catch(() => null)) ?? null;
    if (start) this.starts.set(id, start);
    return start;
  }

  /**
   * What a sealed one is (its type, name, size and shape), from its start, here or on the server; null for one not
   * sealed, or in a vault locked here. The server knows none of it.
   */
  async sealedFacts(id: string): Promise<SealedFacts | null> {
    const local = await this.store.getPhoto(id);
    const start = local ? (local.sealed ? new Uint8Array(await local.blob.slice(0, HEADER_BYTES).arrayBuffer()) : null) : await this.startThere(id);
    const header = start && readHeader(start);
    const key = header && this.keys?.key(header.vaultId);
    return key ? sealedFacts(key, start, id) : null;
  }

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
    await this.keep({ id, vaultId, ...prepared, uploaded: 0, addedAt: this.now() }, { mime: prepared.mime, width: prepared.width, height: prepared.height });
    this.publish({ pending: this.state.pending + 1 });
    void this.upload();
    return id;
  }

  /**
   * Saves a file of any kind for a card in `vaultId`, as it is, and returns what its block keeps: with a sound's
   * length in seconds, when known. Throws, saying why, for one too big to upload.
   */
  async addFile(file: File, vaultId: string, duration: number | null = null): Promise<{ id: string; name: string; mime: string; size: number; duration?: number }> {
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    const id = this.newId();
    const name = file.name || 'Untitled';
    // Without what a recorder adds to its type ("audio/webm;codecs=opus").
    const mime = file.type.split(';')[0].trim() || 'application/octet-stream';
    await this.keep({ id, vaultId, file: { name }, blob: file, mime, width: null, height: null, ...(duration ? { duration } : {}), uploaded: 0, addedAt: this.now() }, { mime, name, ...(duration ? { duration } : {}) });
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
        await this.keep({ id: poster, vaultId, ...prepared, uploaded: 0, addedAt: at }, { mime: prepared.mime, width: prepared.width, height: prepared.height });
        added++;
      }
    }
    await this.keep(
      { id, vaultId, file: { name }, blob: file, mime, width: facts.width, height: facts.height, duration: facts.duration, uploaded: 0, addedAt: at + 1 },
      { mime, name, width: facts.width, height: facts.height, duration: facts.duration },
    );
    this.publish({ pending: this.state.pending + added });
    void this.upload();
    return { id, name, mime, size: file.size, poster, width: facts.width, height: facts.height, duration: facts.duration };
  }

  /**
   * Where a video plays from: this device's copy when it has one (added here, or fetched whole before), else the
   * server, a range at a time, so a long one starts at once and isn't kept whole on every device. A sealed one is
   * fetched whole and opened first, as only this device can read it.
   */
  async playAddress(id: string): Promise<string | null> {
    if ((await this.store.getPhoto(id)) || !this.transport.address || (await this.isSealedThere(id))) return this.url(id);
    return this.transport.address(id);
  }

  /**
   * The photo or file itself, from this device or else the server, opened if it's sealed. Null if the server doesn't
   * have it yet, or it's sealed in a vault locked here; `SealedUnreadable` if it's sealed and its key doesn't open it. One fetched is kept here as it came, sealed if it was, unless
   * it's bigger than `KEEP_BYTES`.
   */
  async blob(id: string): Promise<Blob | null> {
    const local = await this.store.getPhoto(id);
    if (local) return local.sealed ? ((await this.open(local.blob, id))?.blob ?? null) : local.blob;
    const blob = await this.transport.download(id);
    if (!blob) return null;
    const vaultId = await sealedVault(blob);
    if (blob.size <= KEEP_BYTES)
      await this.store.putPhoto({ id, vaultId: vaultId ?? '', blob, mime: vaultId ? SEALED_TYPE : blob.type, width: null, height: null, ...(vaultId ? { sealed: 1 as const } : {}), uploaded: 1, addedAt: this.now() });
    return vaultId ? ((await this.open(blob, id))?.blob ?? null) : blob;
  }

  /**
   * An object URL for a thumbnail: the photo shrunk to `edge` pixels on its longer side, so a grid of them doesn't
   * decode every one at full size. Kept for the most recently shown, and let go after.
   */
  thumbUrl(id: string, edge: number): Promise<string | null> {
    const key = `${id}@${edge}`;
    const had = this.thumbs.get(key);
    if (had) {
      // The most recently asked for go last, the first to be let go.
      this.thumbs.delete(key);
      this.thumbs.set(key, had);
      return had;
    }
    const made = this.blob(id).then(
      async (blob) => {
        if (!blob) this.thumbs.delete(key);
        return blob ? URL.createObjectURL(await shrink(blob, edge)) : null;
      },
      (err: unknown) => {
        this.thumbs.delete(key);
        throw err;
      },
    );
    this.thumbs.set(key, made);
    while (this.thumbs.size > MAX_THUMBS) {
      const [oldest, url] = this.thumbs.entries().next().value!;
      this.thumbs.delete(oldest);
      void url.then((u) => u && URL.revokeObjectURL(u), () => undefined);
    }
    return made;
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
    this.opened.delete(id);
    this.sealedThere.delete(id);
    this.starts.delete(id);
    void url?.then((u) => u && URL.revokeObjectURL(u), () => undefined);
    this.dropThumbs(id);
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

/** How many shrunk thumbnails are kept at once. */
const MAX_THUMBS = 300;

/** A picture no bigger than `edge` pixels on its longer side, as a JPEG; as it was when it's small already, a GIF (which would stop moving), or where the browser can't draw it. */
async function shrink(blob: Blob, edge: number): Promise<Blob> {
  if (blob.type === 'image/gif' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
  try {
    const image = await createImageBitmap(blob);
    const scale = edge / Math.max(image.width, image.height);
    if (scale >= 1) {
      image.close();
      return blob;
    }
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } catch {
    return blob;
  }
}
