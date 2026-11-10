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
}

/** Turns a card payload into the opaque string that is stored. Encryption replaces this later. */
export interface PayloadCodec {
  encode(payload: CardPayload): Promise<string>;
  decode(data: string): Promise<CardPayload>;
}

export const jsonCodec: PayloadCodec = {
  encode: async (payload) => JSON.stringify(payload),
  decode: async (data) => JSON.parse(data) as CardPayload,
};
