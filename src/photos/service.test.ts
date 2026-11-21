import { describe, expect, it } from 'vitest';
import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { fileSize, KEEP_BYTES, MAX_FILE_BYTES, MAX_VIDEO_BYTES, PhotoService, VaultClosed, type VaultKeys } from './service';
import { MemoryPhotoStore, type PhotoRecord, type PhotoTransport, type UploadResult, type VideoFacts } from './types';

function fixture(answers: (UploadResult | 'offline' | 'expired')[] = [], facts: VideoFacts | null = null, keys: VaultKeys | null = null) {
  const store = new MemoryPhotoStore();
  const server = new Map<string, Blob>();
  const uploads: string[] = [];
  const transport: PhotoTransport = {
    upload: async (photo: PhotoRecord, sent) => {
      if (photo.file) sent?.(0.5);
      const answer = answers.shift() ?? 'ok';
      if (answer === 'offline') throw new SyncOffline('offline');
      if (answer === 'expired') throw new SyncAuthExpired('expired');
      if (answer === 'ok') {
        server.set(photo.id, photo.blob);
        uploads.push(photo.id);
      }
      return answer;
    },
    download: async (id) => server.get(id) ?? null,
    start: async (id, bytes) => {
      const blob = server.get(id);
      return blob ? new Uint8Array(await blob.slice(0, bytes).arrayBuffer()) : null;
    },
    address: (id) => `/api/attachments/${id}`,
  };
  let n = 0;
  const photos = new PhotoService(store, transport, async (file) => ({ blob: file, mime: 'image/jpeg', width: 10, height: 5 }), () => `photo-${String(++n).padStart(4, '0')}`, () => 1000, async () => {
    if (!facts) throw new Error("Can't read it");
    return facts;
  }, keys);
  return { store, server, uploads, photos };
}

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

/** A keyring with the diary encrypted, opened and locked by hand. */
async function diaryKeys() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  let open = true;
  const listeners = new Set<() => void>();
  const keys: VaultKeys = {
    isEncrypted: (v) => v === 'diary',
    key: (v) => (v === 'diary' && open ? key : undefined),
    anyEncrypted: () => true,
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  };
  const lock = (locked: boolean) => {
    open = !locked;
    listeners.forEach((l) => l());
  };
  return { keys, lock };
}

describe('PhotoService in an encrypted vault', () => {
  it('keeps and sends a photo or file only sealed, and opens it again here and on another device', async () => {
    const { keys, lock } = await diaryKeys();
    const { photos, store, server } = fixture([], null, keys);
    const pdf = new File(['%PDF secret lease'], 'Lease.pdf', { type: 'application/pdf' });
    const { id } = await photos.addFile(pdf, 'diary');
    const kept = (await store.getPhoto(id))!;
    expect(kept).toMatchObject({ vaultId: 'diary', sealed: 1, mime: 'application/octet-stream' });
    expect(kept.file).toBeUndefined();
    expect(await kept.blob.text()).not.toContain('secret');
    await photos.upload();
    expect(await server.get(id)!.text()).not.toContain('Lease');
    expect(await (await photos.blob(id))!.text()).toBe('%PDF secret lease');
    expect(await photos.sealedFacts(id)).toEqual({ mime: 'application/pdf', name: 'Lease.pdf', size: pdf.size });

    // Another device fetches it, keeps it sealed and opens it; a video sealed on the server is fetched whole to play.
    const other = new PhotoService(new MemoryPhotoStore(), { upload: async () => 'ok', download: async (i) => server.get(i) ?? null, start: async (i, n) => new Uint8Array(await server.get(i)!.slice(0, n).arrayBuffer()), address: (i) => `/api/attachments/${i}` }, async () => ({ blob: image(), mime: 'image/jpeg', width: 1, height: 1 }), undefined, undefined, undefined, keys);
    expect((await other.playAddress(id))!.startsWith('blob:')).toBe(true);
    expect(await (await other.blob(id))!.text()).toBe('%PDF secret lease');
    expect(await photos.url(id)).toMatch(/^blob:/);
    // Locked, nothing opens, and what was shown is forgotten.
    lock(true);
    expect(await other.blob(id)).toBeNull();
    expect(await photos.url(id)).toBeNull();
    expect(await photos.sealedFacts(id)).toBeNull();
    // A vault locked here takes nothing new.
    await expect(photos.add(image(), 'diary')).rejects.toBeInstanceOf(VaultClosed);
    // Any other vault's stay as they are, and stream.
    lock(false);
    const plain = await photos.add(image(), 'v1');
    expect((await store.getPhoto(plain))!.sealed).toBeUndefined();
    await photos.upload();
    expect(await other.playAddress(plain)).toBe(`/api/attachments/${plain}`);
  });
});

describe('keeping what was fetched', () => {
  it('keeps one fetched on the device, unless it is as big as a long video', async () => {
    const { photos, store, server } = fixture();
    server.set('small', image());
    const big = image();
    Object.defineProperty(big, 'size', { value: KEEP_BYTES + 1 });
    server.set('big', big);
    expect(await photos.blob('small')).not.toBeNull();
    expect(await photos.blob('big')).toBe(big);
    expect(await store.getPhoto('small')).toBeDefined();
    expect(await store.getPhoto('big')).toBeUndefined();
  });
});

describe('telling a sealed video on the server', () => {
  it('asks again after no answer, and not at all for one the server listed', async () => {
    const { keys } = await diaryKeys();
    const starts: string[] = [];
    let answer: Uint8Array | null = null;
    const transport = { upload: async () => 'ok' as const, download: async () => null, start: async (id: string) => (starts.push(id), answer), address: (id: string) => `/api/attachments/${id}` };
    const photos = new PhotoService(new MemoryPhotoStore(), transport, async () => ({ blob: image(), mime: 'image/jpeg', width: 1, height: 1 }), undefined, undefined, undefined, keys);
    // Not uploaded yet: streamed for now, and asked again next time rather than taken as not sealed for good.
    expect(await photos.playAddress('v1')).toBe('/api/attachments/v1');
    answer = new Uint8Array([1, 2, 3]);
    expect(await photos.playAddress('v1')).toBe('/api/attachments/v1');
    expect(await photos.playAddress('v1')).toBe('/api/attachments/v1');
    expect(starts).toEqual(['v1', 'v1']);
    photos.learn([{ id: 'v2', sealed: 0 }]);
    expect(await photos.playAddress('v2')).toBe('/api/attachments/v2');
    expect(starts).toEqual(['v1', 'v1']);
  });
});

describe('PhotoService', () => {
  it('keeps a file as it is, under its name, and uploads it with the photos', async () => {
    const { photos, store, uploads } = fixture();
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'Itinerary.pdf', { type: 'application/pdf' });
    expect(await photos.addFile(pdf, 'v1')).toEqual({ id: 'photo-0001', name: 'Itinerary.pdf', mime: 'application/pdf', size: 4 });
    const kept = await store.getPhoto('photo-0001');
    expect(kept).toMatchObject({ vaultId: 'v1', file: { name: 'Itinerary.pdf' }, mime: 'application/pdf', blob: pdf });
    await photos.upload();
    expect(uploads).toEqual(['photo-0001']);
    expect((await photos.addFile(new File([], 'notes.txt'), 'v1').catch((e: Error) => e.message))).toBe('notes.txt is empty.');
    const huge = new File([new Uint8Array(1)], 'movie.mov');
    Object.defineProperty(huge, 'size', { value: MAX_FILE_BYTES + 1 });
    expect((await photos.addFile(huge, 'v1').catch((e: Error) => e.message))).toBe('movie.mov is 25 MB. Files can be up to 25 MB.');
  });
  it('says how big a file is', () => {
    expect([fileSize(512), fileSize(2048), fileSize(3.45 * 1024 * 1024), fileSize(12.6 * 1024 * 1024), fileSize(1024 ** 3), fileSize(1.25 * 1024 ** 3)]).toEqual(['512 B', '2 KB', '3.5 MB', '13 MB', '1 GB', '1.3 GB']);
  });
  it('keeps a video as it is with a still from it, says how far its upload is, and plays it from here', async () => {
    const still = new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
    const { photos, store, uploads } = fixture([], { poster: still, width: 1920, height: 1080, duration: 7.4 });
    const clip = new File([new Uint8Array([0, 0, 0, 24])], 'Beach.MOV');
    const seen: unknown[] = [];
    photos.subscribe(() => seen.push(photos.getState().sending));
    expect(await photos.addVideo(clip, 'v1')).toEqual({ id: 'photo-0001', name: 'Beach.MOV', mime: 'video/quicktime', size: 4, poster: 'photo-0001-poster', width: 1920, height: 1080, duration: 7.4 });
    expect(await store.getPhoto('photo-0001-poster')).toMatchObject({ vaultId: 'v1', mime: 'image/jpeg', uploaded: 0 });
    expect(await store.getPhoto('photo-0001')).toMatchObject({ file: { name: 'Beach.MOV' }, width: 1920, height: 1080, blob: clip });
    await photos.upload();
    // The still first, so the video shows on other devices before it has all gone up.
    expect(uploads).toEqual(['photo-0001-poster', 'photo-0001']);
    expect(seen).toContainEqual({ id: 'photo-0001', done: 0.5 });
    expect(photos.getState()).toEqual({ pending: 0, problem: null, sending: null });
    expect(await photos.playAddress('photo-0001')).toMatch(/^blob:/);
    expect(await photos.playAddress('from-elsewhere')).toBe('/api/attachments/from-elsewhere');
  });
  it('attaches a video this browser cannot read without a still, and turns down one too big', async () => {
    const { photos, store } = fixture();
    expect(await photos.addVideo(new File([new Uint8Array(3)], 'clip.mkv', { type: 'video/x-matroska' }), 'v1')).toMatchObject({ poster: null, width: null, duration: null, mime: 'video/x-matroska' });
    expect([...store.photos.keys()]).toEqual(['photo-0001']);
    const huge = new File([new Uint8Array(1)], 'long.mp4');
    Object.defineProperty(huge, 'size', { value: MAX_VIDEO_BYTES + 1 });
    expect(await photos.addVideo(huge, 'v1').catch((e: Error) => e.message)).toBe('long.mp4 is 1 GB. Videos can be up to 1 GB.');
  });
  it('saves locally, returns an ID at once, and uploads in the background', async () => {
    const { photos, store, uploads } = fixture();
    const id = await photos.add(image(), 'v1');
    expect(id).toBe('photo-0001');
    await photos.upload();
    expect(uploads).toEqual(['photo-0001']);
    expect((await store.getPhoto(id))?.uploaded).toBe(1);
    expect(photos.getState()).toEqual({ pending: 0, problem: null, sending: null });
  });
  it('keeps photos waiting while offline or without Drive, then uploads them', async () => {
    const { photos, uploads } = fixture(['offline', 'offline', 'needs_drive']);
    // Adding starts an upload; this call queues a second pass behind it.
    await photos.add(image(), 'v1');
    await photos.upload();
    expect(photos.getState()).toMatchObject({ pending: 1, problem: 'offline' });
    await photos.upload();
    expect(photos.getState()).toMatchObject({ pending: 1, problem: 'needs_drive' });
    expect(uploads).toEqual([]);
    await photos.upload();
    expect(uploads).toEqual(['photo-0001']);
    expect(photos.getState()).toEqual({ pending: 0, problem: null, sending: null });
  });
  it('says when uploads wait for signing in again, not for a connection', async () => {
    const { photos } = fixture(['expired', 'expired']);
    await photos.add(image(), 'v1');
    await photos.upload();
    expect(photos.getState()).toMatchObject({ pending: 1, problem: 'expired' });
  });
  it('fetches a photo from another device once, then keeps it', async () => {
    const { photos, server, store } = fixture();
    expect(await photos.blob('elsewhere')).toBeNull();
    server.set('elsewhere', image());
    expect(await photos.blob('elsewhere')).not.toBeNull();
    server.delete('elsewhere');
    expect(await photos.blob('elsewhere')).not.toBeNull();
    expect((await store.getPhoto('elsewhere'))?.uploaded).toBe(1);
  });
  it('shares one object URL per photo and retries a missing one later', async () => {
    const { photos, server } = fixture();
    expect(await photos.url('later')).toBeNull();
    server.set('later', image());
    const first = await photos.url('later');
    expect(first).toMatch(/^blob:/);
    expect(await photos.url('later')).toBe(first);
  });
});
