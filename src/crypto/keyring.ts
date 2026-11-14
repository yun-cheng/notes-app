import { parsePayload } from '../domain/payload';
import type { CardPayload, Vault } from '../domain/types';
import type { CodecContext, PayloadCodec } from '../storage/types';
import { decryptPayload, encryptPayload, isEncryptedPayload } from './vaultKeys';

export class VaultSealed extends Error {}

/**
 * The open vault keys on this device, held in memory only, and the codec that uses them.
 * Cards in an encrypted vault are encrypted as they're written; a card whose key isn't here
 * decodes to null, and the app treats it as locked.
 */
export class Keyring implements PayloadCodec {
  private keys = new Map<string, CryptoKey>();
  private encrypted = new Set<string>();
  private listeners = new Set<() => void>();
  private generation = 0;

  /** Changes whenever a key is added or forgotten, so decoded cards can be refreshed. */
  getGeneration = () => this.generation;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private changed() {
    this.generation++;
    this.listeners.forEach((l) => l());
  }

  setVaults(vaults: Vault[]) {
    this.encrypted = new Set(vaults.filter((v) => v.encryption).map((v) => v.id));
  }

  isEncrypted = (vaultId: string) => this.encrypted.has(vaultId);

  key(vaultId: string): CryptoKey | undefined {
    return this.keys.get(vaultId);
  }

  set(vaultId: string, key: CryptoKey) {
    this.keys.set(vaultId, key);
    this.changed();
  }

  forget(vaultId: string) {
    if (this.keys.delete(vaultId)) this.changed();
  }

  forgetAll() {
    if (!this.keys.size) return;
    this.keys.clear();
    this.changed();
  }

  async encode(payload: CardPayload, { id, vaultId }: CodecContext): Promise<string> {
    const text = JSON.stringify(payload);
    if (!this.encrypted.has(vaultId)) return text;
    const key = this.keys.get(vaultId);
    if (!key) throw new VaultSealed('Unlock the vault before changing its cards');
    return encryptPayload(key, text, id, vaultId);
  }

  async decode(data: string, { id, vaultId }: CodecContext): Promise<CardPayload | null> {
    if (!isEncryptedPayload(data)) return parsePayload(data);
    const key = this.keys.get(vaultId);
    const text = key && (await decryptPayload(key, data, id, vaultId));
    return text ? parsePayload(text) : null;
  }
}
