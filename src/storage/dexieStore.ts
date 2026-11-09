import Dexie, { liveQuery, type Table } from 'dexie';
import type { CardRecord, Vault } from '../domain/types';
import type { CardStore } from './types';

class NotesDb extends Dexie {
  cards!: Table<CardRecord, string>;
  vaults!: Table<Vault, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ cards: 'id, vault_id, updated_at, seq', vaults: 'id' });
  }
}

export class DexieStore implements CardStore {
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
    await this.db.cards.bulkPut(records);
  }
  listVaults() {
    return this.db.vaults.toArray();
  }
  async putVaults(vaults: Vault[]) {
    await this.db.vaults.bulkPut(vaults);
  }
  subscribe(listener: (records: CardRecord[]) => void) {
    const subscription = liveQuery(() => this.db.cards.toArray()).subscribe({
      next: listener,
      error: (err) => console.error('Reading cards failed', err),
    });
    return () => subscription.unsubscribe();
  }
}
