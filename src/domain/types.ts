export interface JSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export const EMPTY_DOC: JSONNode = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Fields the sync server can see. Everything else lives in the payload. */
interface CardEnvelope {
  id: string;
  vaultId: string;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

interface CardCommon extends CardEnvelope {
  createdAt: number;
  title: string;
  content: JSONNode;
  /** IDs of tag cards. Tagging is a typed link to the tag card. */
  tags: string[];
}

export interface NoteCard extends CardCommon {
  type: 'note';
}
export interface TodoCard extends CardCommon {
  type: 'todo';
  status: 'open' | 'done';
  /** Local date key (YYYY-MM-DD), or null for no due date. */
  due: string | null;
  completedAt: number | null;
}
export interface DiaryCard extends CardCommon {
  type: 'diary';
  date: string;
}
export interface TagCard extends CardCommon {
  type: 'tag';
  /** A pinned tag appears in the sidebar and acts as a folder. */
  pinned: boolean;
}

export type Card = NoteCard | TodoCard | DiaryCard | TagCard;
export type CardType = Card['type'];
export const CARD_TYPES: readonly CardType[] = ['note', 'todo', 'diary', 'tag'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CardPayload = DistributiveOmit<Card, keyof CardEnvelope>;

/** The stored and synced shape. `payload` is opaque: JSON now, ciphertext later. */
export interface CardRecord {
  id: string;
  vault_id: string;
  updated_at: number;
  deleted: boolean;
  seq: number;
  payload: string;
}

export interface Vault {
  id: string;
  name: string;
  owner_id: string;
  lock: 'none' | 'pin';
  ai_access: 'off' | 'read' | 'write';
  created_at: number;
}
