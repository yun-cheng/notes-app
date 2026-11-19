import { describe, expect, it } from 'vitest';
import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { fileSize, MAX_FILE_BYTES, PhotoService } from './service';
import { MemoryPhotoStore, type PhotoRecord, type PhotoTransport, type UploadResult } from './types';

function fixture(answers: (UploadResult | 'offline' | 'expired')[] = []) {
  const store = new MemoryPhotoStore();
  const server = new Map<string, Blob>();
  const uploads: string[] = [];
  const transport: PhotoTransport = {
    upload: async (photo: PhotoRecord) => {
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
  };
  let n = 0;
  const photos = new PhotoService(store, transport, async (file) => ({ blob: file, mime: 'image/jpeg', width: 10, height: 5 }), () => `photo-${String(++n).padStart(4, '0')}`);
  return { store, server, uploads, photos };
}

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

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
    expect([fileSize(512), fileSize(2048), fileSize(3.45 * 1024 * 1024), fileSize(12.6 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '3.5 MB', '13 MB']);
  });
  it('saves locally, returns an ID at once, and uploads in the background', async () => {
    const { photos, store, uploads } = fixture();
    const id = await photos.add(image(), 'v1');
    expect(id).toBe('photo-0001');
    await photos.upload();
    expect(uploads).toEqual(['photo-0001']);
    expect((await store.getPhoto(id))?.uploaded).toBe(1);
    expect(photos.getState()).toEqual({ pending: 0, problem: null });
  });
  it('keeps photos waiting while offline or without Drive, then uploads them', async () => {
    const { photos, uploads } = fixture(['offline', 'offline', 'needs_drive']);
    // Adding starts an upload; this call queues a second pass behind it.
    await photos.add(image(), 'v1');
    await photos.upload();
    expect(photos.getState()).toEqual({ pending: 1, problem: 'offline' });
    await photos.upload();
    expect(photos.getState()).toEqual({ pending: 1, problem: 'needs_drive' });
    expect(uploads).toEqual([]);
    await photos.upload();
    expect(uploads).toEqual(['photo-0001']);
    expect(photos.getState()).toEqual({ pending: 0, problem: null });
  });
  it('says when uploads wait for signing in again, not for a connection', async () => {
    const { photos } = fixture(['expired', 'expired']);
    await photos.add(image(), 'v1');
    await photos.upload();
    expect(photos.getState()).toEqual({ pending: 1, problem: 'expired' });
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
