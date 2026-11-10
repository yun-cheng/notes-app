import Dexie, { liveQuery, type Table } from 'dexie';
import type { CardRecord, Vault } from '../domain/types';
import type { PhotoRecord, PhotoStore } from '../photos/types';
import type { CardStore } from './types';

class NotesDb extends Dexie {
  cards!: Table<CardRecord, string>;
  vaults!: Table<Vault, string>;
  dirty!: Table<{ id: string }, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  photos!: Table<PhotoRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ cards: 'id, vault_id, updated_at, seq', vaults: 'id' });
    this.version(2).stores({ dirty: 'id', meta: 'key' });
    this.version(3).stores({ photos: 'id, uploaded, addedAt' });
  }
}

export class DexieStore implements CardStore, PhotoStore {
  private db: NotesDb;

  constructor(name = 'notes-app') {
    this.db = new NotesDb(name);
  }

  listCards() {
    return this.db.cards.toArray();
  }
  getCard(id: string) {
    return this.db.cards.get(id);
  }
  async putCards(records: CardRecord[]) {
    const { cards, dirty } = this.db;
    await this.db.transaction('rw', cards, dirty, async () => {
      await cards.bulkPut(records);
      await dirty.bulkPut(records.map(({ id }) => ({ id })));
    });
  }
  async listDirty() {
    const ids = await this.db.dirty.toCollection().primaryKeys();
    const records = await this.db.cards.bulkGet(ids);
    return records.filter((r): r is CardRecord => !!r);
  }
  async applyRemote(records: CardRecord[]) {
    const { cards, dirty } = this.db;
    await this.db.transaction('rw', cards, dirty, async () => {
      const ids = records.map((r) => r.id);
      const [pending, current] = await Promise.all([dirty.bulkGet(ids), cards.bulkGet(ids)]);
      const changed = records.filter((r, i) => !pending[i] && current[i]?.seq !== r.seq);
      if (changed.length) await cards.bulkPut(changed);
    });
  }
  async forceRemote(record: CardRecord) {
    const { cards, dirty } = this.db;
    await this.db.transaction('rw', cards, dirty, async () => {
      await cards.put(record);
      await dirty.delete(record.id);
    });
  }
  async markSynced(id: string, updatedAt: number, seq: number) {
    const { cards, dirty } = this.db;
    await this.db.transaction('rw', cards, dirty, async () => {
      const card = await cards.get(id);
      if (!card) return;
      await cards.put({ ...card, seq });
      if (card.updated_at === updatedAt) await dirty.delete(id);
    });
  }
  async getMeta(key: string) {
    return (await this.db.meta.get(key))?.value;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.meta.put({ key, value });
  }
  listVaults() {
    return this.db.vaults.toArray();
  }
  async putVaults(vaults: Vault[]) {
    await this.db.vaults.bulkPut(vaults);
  }
  async replaceVaults(vaults: Vault[]) {
    await this.db.transaction('rw', this.db.vaults, async () => {
      const keep = new Set(vaults.map((v) => v.id));
      const gone = (await this.db.vaults.toCollection().primaryKeys()).filter((id) => !keep.has(id));
      await this.db.vaults.bulkDelete(gone);
      await this.db.vaults.bulkPut(vaults);
    });
  }
  async deleteCards(ids: string[]) {
    const { cards, dirty } = this.db;
    await this.db.transaction('rw', cards, dirty, async () => {
      await cards.bulkDelete(ids);
      await dirty.bulkDelete(ids);
    });
  }
  subscribeVaults(listener: (vaults: Vault[]) => void) {
    const subscription = liveQuery(() => this.db.vaults.toArray()).subscribe({
      next: listener,
      error: (err) => console.error('Reading vaults failed', err),
    });
    return () => subscription.unsubscribe();
  }
  async putPhoto(photo: PhotoRecord) {
    await this.db.photos.put(photo);
  }
  getPhoto(id: string) {
    return this.db.photos.get(id);
  }
  async pendingPhotos() {
    return (await this.db.photos.where('uploaded').equals(0).toArray()).sort((a, b) => a.addedAt - b.addedAt);
  }
  async markPhotoUploaded(id: string) {
    await this.db.photos.update(id, { uploaded: 1 });
  }
  async destroy() {
    await this.db.delete();
  }
  subscribe(listener: (records: CardRecord[]) => void) {
    const subscription = liveQuery(() => this.db.cards.toArray()).subscribe({
      next: listener,
      error: (err) => console.error('Reading cards failed', err),
    });
    return () => subscription.unsubscribe();
  }
}
