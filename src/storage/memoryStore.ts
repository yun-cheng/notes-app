import type { CardRecord, Vault } from '../domain/types';
import type { CardStore } from './types';

export class MemoryStore implements CardStore {
  private cards = new Map<string, CardRecord>();
  private vaults = new Map<string, Vault>();
  private listeners = new Set<(records: CardRecord[]) => void>();

  async listCards() {
    return [...this.cards.values()];
  }
  async getCard(id: string) {
    return this.cards.get(id);
  }
  async putCards(records: CardRecord[]) {
    records.forEach((r) => this.cards.set(r.id, r));
    const all = [...this.cards.values()];
    this.listeners.forEach((l) => l(all));
  }
  async listVaults() {
    return [...this.vaults.values()];
  }
  async putVaults(vaults: Vault[]) {
    vaults.forEach((v) => this.vaults.set(v.id, v));
  }
  subscribe(listener: (records: CardRecord[]) => void) {
    this.listeners.add(listener);
    listener([...this.cards.values()]);
    return () => void this.listeners.delete(listener);
  }
}
