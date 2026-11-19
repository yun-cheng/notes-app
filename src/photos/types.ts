/** A photo, or a file attached as it is, kept on this device: one added here waiting to upload, or one fetched to show. */
export interface PhotoRecord {
  id: string;
  /** Set for a file of any kind, kept as it is, rather than a photo. */
  file?: { name: string };
  /** The vault it was added in. Empty for a photo fetched from the server. */
  vaultId: string;
  blob: Blob;
  mime: string;
  width: number | null;
  height: number | null;
  /** 0 until the server has it. A number, so IndexedDB can index it. */
  uploaded: 0 | 1;
  addedAt: number;
}

export interface PhotoStore {
  putPhoto(photo: PhotoRecord): Promise<void>;
  getPhoto(id: string): Promise<PhotoRecord | undefined>;
  pendingPhotos(): Promise<PhotoRecord[]>;
  markPhotoUploaded(id: string): Promise<void>;
  /** Drops this device's copy, of one deleted for good. */
  deletePhoto(id: string): Promise<void>;
}

export type UploadResult = 'ok' | 'needs_drive' | 'not_configured' | 'rejected';

export interface PhotoTransport {
  /** Sends it; a big file goes in pieces, `sent` told how far along it is, from 0 to 1. */
  upload(photo: PhotoRecord, sent?: (done: number) => void): Promise<UploadResult>;
  /** The photo, or null if the server doesn't have it yet. */
  download(id: string): Promise<Blob | null>;
  /** Where a video plays from on the server, a range at a time, rather than fetched whole first. */
  address?(id: string): string;
}

/** What a video was found to be when added (`probeVideo`): null for what the browser couldn't tell. */
export interface VideoFacts {
  /** A still from it, to show before it plays. */
  poster: Blob | null;
  width: number | null;
  height: number | null;
  /** Its length, in seconds. */
  duration: number | null;
}

export interface PreparedPhoto {
  blob: Blob;
  mime: string;
  width: number | null;
  height: number | null;
}

export class MemoryPhotoStore implements PhotoStore {
  photos = new Map<string, PhotoRecord>();
  async putPhoto(photo: PhotoRecord) {
    this.photos.set(photo.id, photo);
  }
  async getPhoto(id: string) {
    return this.photos.get(id);
  }
  async pendingPhotos() {
    return [...this.photos.values()].filter((p) => !p.uploaded).sort((a, b) => a.addedAt - b.addedAt);
  }
  async markPhotoUploaded(id: string) {
    const photo = this.photos.get(id);
    if (photo) this.photos.set(id, { ...photo, uploaded: 1 });
  }
  async deletePhoto(id: string) {
    this.photos.delete(id);
  }
}
