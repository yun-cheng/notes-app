/** A photo kept on this device: one added here waiting to upload, or one fetched to show. */
export interface PhotoRecord {
  id: string;
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
}

export type UploadResult = 'ok' | 'needs_drive' | 'not_configured' | 'rejected';

export interface PhotoTransport {
  upload(photo: PhotoRecord): Promise<UploadResult>;
  /** The photo, or null if the server doesn't have it yet. */
  download(id: string): Promise<Blob | null>;
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
}
