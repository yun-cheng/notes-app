import Dexie, { liveQuery, type Table } from 'dexie';
import type { ChangeEntry } from '../domain/changes';
import type { CardRecord, Vault } from '../domain/types';
import type { PhotoRecord, PhotoStore } from '../photos/types';
import type { CardStore, SavedTranslation, TranslationStore } from './types';

class NotesDb extends Dexie {
  cards!: Table<CardRecord, string>;
  vaults!: Table<Vault, string>;
  dirty!: Table<{ id: string }, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  photos!: Table<PhotoRecord, string>;
  changes!: Table<ChangeEntry, number>;
  translations!: Table<SavedTranslation, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ cards: 'id, vault_id, updated_at, seq', vaults: 'id' });
    this.version(2).stores({ dirty: 'id', meta: 'key' });
    this.version(3).stores({ photos: 'id, uploaded, addedAt' });
    this.version(4).stores({ changes: '++n' });
    this.version(5).stores({ translations: 'cardId' });
  }
}

/** Where a card with this ID is in records kept in ID order, or would go: as IndexedDB orders the keys. */
function placeOf(records: readonly CardRecord[], id: string): { at: number; found: boolean } {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid].id < id) lo = mid + 1;
    else hi = mid;
  }
  return { at: lo, found: records[lo]?.id === id };
}

/** Records in ID order with these written and those removed, as a new list. */
function withWrite(records: readonly CardRecord[], put: readonly CardRecord[], removed: readonly string[]): CardRecord[] {
  const next = records.slice();
  for (const record of put) {
    const { at, found } = placeOf(next, record.id);
    next.splice(at, found ? 1 : 0, record);
  }
  for (const id of removed) {
    const { at, found } = placeOf(next, id);
    if (found) next.splice(at, 1);
  }
  return next;
}

export class DexieStore implements CardStore, PhotoStore, TranslationStore {
  private db: NotesDb;
  /**
   * Every card, in ID order, as `subscribe` gives them: read in full once, then kept up to date with this store's own
   * writes, so a change doesn't read thousands of cards back. Another tab's writes (heard on `channel`) read them all
   * again. Null until something subscribes, and while it's first read.
   */
  private mirror: CardRecord[] | null = null;
  private cardListeners = new Set<(records: CardRecord[]) => void>();
  /** Writes made while every card is being read, put on top of what's read, in order: a read may or may not see them. */
  private during: { put: readonly CardRecord[]; removed: readonly string[] }[] | null = null;
  private reads = 0;
  private channel: BroadcastChannel | null = null;

  constructor(name = 'notes-app') {
    this.db = new NotesDb(name);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`notes-app:cards:${name}`);
      this.channel.onmessage = () => {
        if (this.cardListeners.size) void this.readAll().catch((err: unknown) => console.error('Reading cards failed', err));
      };
      // Where it can be (Node, in tests), it doesn't keep the process going.
      (this.channel as BroadcastChannel & { unref?: () => void }).unref?.();
    }
  }

  /** Reads every card again, with what's written meanwhile put on top, and tells subscribers. */
  private async readAll(): Promise<void> {
    const run = ++this.reads;
    this.during = [];
    const all = await this.db.cards.toArray();
    if (run !== this.reads || !this.cardListeners.size) return;
    const during = this.during;
    this.during = null;
    this.mirror = during.reduce((records, w) => withWrite(records, w.put, w.removed), all);
    for (const listener of this.cardListeners) listener(this.mirror);
  }

  /** What this store just wrote, put into what subscribers have, and told to other tabs. */
  private wrote(put: readonly CardRecord[], removed: readonly string[] = []) {
    if (!put.length && !removed.length) return;
    this.channel?.postMessage('cards');
    this.during?.push({ put, removed });
    if (!this.mirror) return;
    const next = withWrite(this.mirror, put, removed);
    this.mirror = next;
    for (const listener of this.cardListeners) listener(next);
  }

  listCards() {
    return this.db.cards.toArray();
  }

  /** How many changes and photos here aren't on the server yet. */
  async unsent(): Promise<number> {
    const [changes, photos] = await Promise.all([this.db.dirty.count(), this.db.photos.where('uploaded').equals(0).count()]);
    return changes + photos;
  }

  close() {
    this.channel?.close();
    this.channel = null;
    this.db.close();
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
    this.wrote(records);
  }
  async listDirty() {
    const ids = await this.db.dirty.toCollection().primaryKeys();
    const records = await this.db.cards.bulkGet(ids);
    return records.filter((r): r is CardRecord => !!r);
  }
  async applyRemote(records: CardRecord[]) {
    const { cards, dirty } = this.db;
    const changed = await this.db.transaction('rw', cards, dirty, async () => {
      const ids = records.map((r) => r.id);
      const [pending, current] = await Promise.all([dirty.bulkGet(ids), cards.bulkGet(ids)]);
      const changed = records.filter((r, i) => !pending[i] && current[i]?.seq !== r.seq);
      if (changed.length) await cards.bulkPut(changed);
      return changed;
    });
    this.wrote(changed);
  }
  async forceRemote(record: CardRecord, ifUpdatedAt?: number) {
    const { cards, dirty } = this.db;
    const done = await this.db.transaction('rw', cards, dirty, async () => {
      if (ifUpdatedAt !== undefined && (await cards.get(record.id))?.updated_at !== ifUpdatedAt) return false;
      await cards.put(record);
      await dirty.delete(record.id);
      return true;
    });
    if (done) this.wrote([record]);
    return done;
  }
  async markSynced(id: string, updatedAt: number, seq: number) {
    const { cards, dirty } = this.db;
    const marked = await this.db.transaction('rw', cards, dirty, async () => {
      const card = await cards.get(id);
      if (!card) return null;
      const next = { ...card, seq };
      await cards.put(next);
      if (card.updated_at === updatedAt) await dirty.delete(id);
      return next;
    });
    if (marked) this.wrote([marked]);
  }
  listTranslations() {
    return this.db.translations.toArray();
  }
  async putTranslation(translation: SavedTranslation) {
    await this.db.translations.put(translation);
  }
  async deleteTranslations(cardIds: string[]) {
    await this.db.translations.bulkDelete(cardIds);
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
    this.wrote([], ids);
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
  async deletePhoto(id: string) {
    await this.db.photos.delete(id);
  }
  async destroy() {
    this.mirror = null;
    this.reads++;
    await this.db.delete();
  }
  subscribe(listener: (records: CardRecord[]) => void) {
    this.cardListeners.add(listener);
    if (this.cardListeners.size === 1) {
      void this.readAll().catch((err: unknown) => console.error('Reading cards failed', err));
    } else if (this.mirror) {
      listener(this.mirror);
    }
    return () => {
      this.cardListeners.delete(listener);
      if (this.cardListeners.size) return;
      this.mirror = null;
      this.during = null;
      this.reads++;
    };
  }

  subscribeDirty(listener: (ids: string[]) => void) {
    const subscription = liveQuery(() => this.db.dirty.toCollection().primaryKeys()).subscribe({
      next: listener,
      error: (err) => console.error('Reading unsynced cards failed', err),
    });
    return () => subscription.unsubscribe();
  }

  listChanges() {
    return this.db.changes.toArray();
  }
  getChange(n: number) {
    return this.db.changes.get(n);
  }
  lastChange() {
    return this.db.changes.orderBy(':id').last();
  }
  async putChanges(entries: ChangeEntry[]) {
    await this.db.changes.bulkPut(entries);
  }
  async deleteChanges(ns: number[]) {
    await this.db.changes.bulkDelete(ns);
  }
  async trimChanges(keep: number) {
    const { changes } = this.db;
    await this.db.transaction('rw', changes, async () => {
      const extra = (await changes.count()) - keep;
      if (extra > 0) await changes.bulkDelete(await changes.orderBy(':id').limit(extra).primaryKeys());
    });
  }
  subscribeChanges(listener: (entries: ChangeEntry[]) => void) {
    const subscription = liveQuery(() => this.db.changes.toArray()).subscribe({
      next: listener,
      error: (err) => console.error('Reading the change log failed', err),
    });
    return () => subscription.unsubscribe();
  }
}
