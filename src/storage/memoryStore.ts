import type { ChangeEntry } from '../domain/changes';
import type { CardRecord, Vault } from '../domain/types';
import type { CardStore } from './types';

export class MemoryStore implements CardStore {
  private cards = new Map<string, CardRecord>();
  private vaults = new Map<string, Vault>();
  private dirty = new Set<string>();
  private meta = new Map<string, unknown>();
  private listeners = new Set<(records: CardRecord[]) => void>();
  private vaultListeners = new Set<(vaults: Vault[]) => void>();
  private changes = new Map<number, ChangeEntry>();
  private changeListeners = new Set<(entries: ChangeEntry[]) => void>();
  private lastN = 0;

  async listCards() {
    return [...this.cards.values()];
  }
  async getCard(id: string) {
    return this.cards.get(id);
  }
  private notify() {
    const all = [...this.cards.values()];
    this.listeners.forEach((l) => l(all));
  }
  async putCards(records: CardRecord[]) {
    records.forEach((r) => {
      this.cards.set(r.id, r);
      this.dirty.add(r.id);
    });
    this.notify();
  }
  async listDirty() {
    return [...this.dirty].flatMap((id) => this.cards.get(id) ?? []);
  }
  async applyRemote(records: CardRecord[]) {
    records.forEach((r) => {
      if (!this.dirty.has(r.id)) this.cards.set(r.id, r);
    });
    this.notify();
  }
  async forceRemote(record: CardRecord) {
    this.cards.set(record.id, record);
    this.dirty.delete(record.id);
    this.notify();
  }
  async markSynced(id: string, updatedAt: number, seq: number) {
    const card = this.cards.get(id);
    if (!card) return;
    this.cards.set(id, { ...card, seq });
    if (card.updated_at === updatedAt) this.dirty.delete(id);
  }
  async getMeta(key: string) {
    return this.meta.get(key);
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
  async listVaults() {
    return [...this.vaults.values()];
  }
  async putVaults(vaults: Vault[]) {
    vaults.forEach((v) => this.vaults.set(v.id, v));
    const all = [...this.vaults.values()];
    this.vaultListeners.forEach((l) => l(all));
  }
  async replaceVaults(vaults: Vault[]) {
    this.vaults.clear();
    await this.putVaults(vaults);
  }
  async deleteCards(ids: string[]) {
    ids.forEach((id) => {
      this.cards.delete(id);
      this.dirty.delete(id);
    });
    this.notify();
  }
  subscribeVaults(listener: (vaults: Vault[]) => void) {
    this.vaultListeners.add(listener);
    listener([...this.vaults.values()]);
    return () => void this.vaultListeners.delete(listener);
  }
  subscribe(listener: (records: CardRecord[]) => void) {
    this.listeners.add(listener);
    listener([...this.cards.values()]);
    return () => void this.listeners.delete(listener);
  }

  private notifyChanges() {
    const all = [...this.changes.values()];
    this.changeListeners.forEach((l) => l(all));
  }
  async listChanges() {
    return [...this.changes.values()];
  }
  async getChange(n: number) {
    return this.changes.get(n);
  }
  async lastChange() {
    return this.changes.get(Math.max(...this.changes.keys()));
  }
  async putChanges(entries: ChangeEntry[]) {
    // Replaced entries keep their place, so the map stays in order of `n`.
    for (const entry of entries) {
      const n = entry.n ?? ++this.lastN;
      this.changes.set(n, { ...entry, n });
    }
    this.notifyChanges();
  }
  async deleteChanges(ns: number[]) {
    ns.forEach((n) => this.changes.delete(n));
    this.notifyChanges();
  }
  async trimChanges(keep: number) {
    const extra = [...this.changes.keys()].slice(0, Math.max(0, this.changes.size - keep));
    if (extra.length) await this.deleteChanges(extra);
  }
  subscribeChanges(listener: (entries: ChangeEntry[]) => void) {
    this.changeListeners.add(listener);
    listener([...this.changes.values()]);
    return () => void this.changeListeners.delete(listener);
  }
}
