import type { ChangeEntry } from '../domain/changes';
import type { CardPayload, CardRecord, Vault } from '../domain/types';

/** Device storage. The UI never touches this directly, so a Tauri backend can replace it. */
export interface CardStore {
  listCards(): Promise<CardRecord[]>;
  getCard(id: string): Promise<CardRecord | undefined>;
  /** Saves local changes and marks them as needing to be pushed. */
  putCards(records: CardRecord[]): Promise<void>;
  listDirty(): Promise<CardRecord[]>;
  /** Saves records from the server, skipping any card with unpushed local changes. */
  applyRemote(records: CardRecord[]): Promise<void>;
  /** Replaces a card with the server's version and discards its unpushed state. */
  forceRemote(record: CardRecord): Promise<void>;
  /** Records the seq a push was given. The card stays dirty if it changed since `updatedAt`. */
  markSynced(id: string, updatedAt: number, seq: number): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
  listVaults(): Promise<Vault[]>;
  putVaults(vaults: Vault[]): Promise<void>;
  /** Makes `vaults` the whole list, dropping any others. */
  replaceVaults(vaults: Vault[]): Promise<void>;
  /** Removes cards outright, with any unpushed state. For cards this account can no longer see. */
  deleteCards(ids: string[]): Promise<void>;
  /** Calls back with every vault now and after any change. */
  subscribeVaults(listener: (vaults: Vault[]) => void): () => void;
  /** Calls back with every record now and after any change, including from other tabs. */
  subscribe(listener: (records: CardRecord[]) => void): () => void;

  // The change log: what this device changed, for the history and for undo. It never leaves the device.

  /** Every logged change, oldest first. */
  listChanges(): Promise<ChangeEntry[]>;
  getChange(n: number): Promise<ChangeEntry | undefined>;
  /** The newest logged change. */
  lastChange(): Promise<ChangeEntry | undefined>;
  /** Adds entries that have no `n` yet, and replaces the ones that do. */
  putChanges(entries: ChangeEntry[]): Promise<void>;
  deleteChanges(ns: number[]): Promise<void>;
  /** Drops the oldest changes, so no more than `keep` are left. */
  trimChanges(keep: number): Promise<void>;
  /** Calls back with the whole log, oldest first, now and after any change to it. */
  subscribeChanges(listener: (entries: ChangeEntry[]) => void): () => void;
}

export interface CodecContext {
  id: string;
  vaultId: string;
}

/** Turns a card payload into the opaque string that is stored: JSON, or ciphertext in an encrypted vault. */
export interface PayloadCodec {
  encode(payload: CardPayload, context: CodecContext): Promise<string>;
  /** Null when the payload can't be read on this device right now, because its vault key isn't open. */
  decode(data: string, context: CodecContext): Promise<CardPayload | null>;
  /** True for a vault whose cards must be stored encrypted. */
  isEncrypted?(vaultId: string): boolean;
}

export const jsonCodec: PayloadCodec = {
  encode: async (payload) => JSON.stringify(payload),
  decode: async (data) => JSON.parse(data) as CardPayload,
};
