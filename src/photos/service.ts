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
  /** The vault each sealed one shown here is in, so it stops showing once that vault locks. */
  private opened = new Map<string, string>();
  /** Whether each the server has, not here, is sealed, as found from its start. */
  private sealedThere = new Map<string, Promise<boolean>>();

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
    }
  }

  /**
   * Keeps one added here, to upload: sealed with its vault's key when that vault is encrypted, so neither this
   * device's storage nor the server holds it readable. Its name, type and shape go in the seal.
   */
  private async keep(record: PhotoRecord, facts: Omit<SealedFacts, 'size'>, seal = !!this.keys?.isEncrypted(record.vaultId)): Promise<void> {
    if (!seal) return this.store.putPhoto(record);
    const key = this.keys?.key(record.vaultId);
    if (!key) throw new VaultClosed('Open the vault first.');
    const blob = await sealAttachment(key, record.blob, record.id, record.vaultId, facts);
    await this.store.putPhoto({ id: record.id, vaultId: record.vaultId, blob, mime: SEALED_TYPE, width: null, height: null, sealed: 1, uploaded: 0, addedAt: record.addedAt });
  }

  /** A sealed one opened with its vault's key; null while that vault is locked here. One that only looked sealed is itself. */
  private async open(blob: Blob, id: string): Promise<Blob | null> {
    const vaultId = await sealedVault(blob);
    if (!vaultId) return blob;
    const key = this.keys?.key(vaultId);
    if (!key) return null;
    const opened = await openAttachment(key, blob, id);
    if (!opened) return blob;
    this.opened.set(id, vaultId);
    return opened.blob;
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
    if (!raw) return false;
    let blob = raw;
    let told: Partial<SealedFacts> = local && !local.sealed ? { mime: local.mime, name: local.file?.name, width: local.width, height: local.height, duration: local.duration } : {};
    const sealedFor = await sealedVault(raw);
    if (sealedFor) {
      const key = this.keys?.key(sealedFor);
      const opened = key && (await openAttachment(key, raw, id));
      if (!opened) return false;
      blob = opened.blob;
      told = opened.facts;
    }
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

  /** Whether one the server has, and this device doesn't, is sealed: from its first bytes, asked once. */
  private isSealedThere(id: string): Promise<boolean> {
    if (!this.keys?.anyEncrypted() || !this.transport.start) return Promise.resolve(false);
    let found = this.sealedThere.get(id);
    if (!found) {
      found = this.transport.start(id, HEADER_BYTES).then(
        (start) => !!start && !!readHeader(start),
        () => false,
      );
      this.sealedThere.set(id, found);
    }
    return found;
  }

  /**
   * What a sealed one is (its type, name, size and shape), from its start, here or on the server; null for one not
   * sealed, or in a vault locked here. The server knows none of it.
   */
  async sealedFacts(id: string): Promise<SealedFacts | null> {
    const local = await this.store.getPhoto(id);
    const start = local ? (local.sealed ? new Uint8Array(await local.blob.slice(0, HEADER_BYTES).arrayBuffer()) : null) : await this.transport.start?.(id, HEADER_BYTES);
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
   * have it yet, or it's sealed in a vault locked here. A sealed one is kept here as it came, sealed.
   */
  async blob(id: string): Promise<Blob | null> {
    const local = await this.store.getPhoto(id);
    if (local) return local.sealed ? this.open(local.blob, id) : local.blob;
    const blob = await this.transport.download(id);
    if (!blob) return null;
    const vaultId = await sealedVault(blob);
    await this.store.putPhoto({ id, vaultId: vaultId ?? '', blob, mime: vaultId ? SEALED_TYPE : blob.type, width: null, height: null, ...(vaultId ? { sealed: 1 as const } : {}), uploaded: 1, addedAt: this.now() });
    return vaultId ? this.open(blob, id) : blob;
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
