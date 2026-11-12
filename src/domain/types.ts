import type { VaultEncryption } from '../crypto/vaultKeys';
import type { VaultPin } from './pin';

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

/** How a web link in an entry is previewed under it: a card with the page's title, description and image, one line, or not at all. */
export type LinkStyle = 'card' | 'compact' | 'off';
/** How an entry's photos show under it: large, as small thumbnails, or as a count that opens them. */
export type PhotoStyle = 'large' | 'thumbs' | 'off';

/** One entry's own preview style. What it leaves out follows the device's setting. */
export interface PreviewStyle {
  links?: LinkStyle;
  photos?: PhotoStyle;
}

/** A color an entry's bubble can be tinted with. */
export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const;
export type CardColor = (typeof CARD_COLORS)[number];
export const isCardColor = (v: unknown): v is CardColor => typeof v === 'string' && (CARD_COLORS as readonly string[]).includes(v);

interface CardCommon extends CardEnvelope {
  createdAt: number;
  title: string;
  content: JSONNode;
  /** IDs of tag cards. Tagging is a typed link to the tag card. */
  tags: string[];
  /** Set from the entry's style menu; missing on most cards. */
  preview?: PreviewStyle;
  /** The bubble's tint, or none. */
  color?: CardColor | null;
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
  /** Set when `lock` is 'pin'. */
  pin: VaultPin | null;
  /** Left out of the app entirely until unlocked. */
  hidden: boolean;
  /** This account's role in the vault, from the server. Missing for a vault made before sign-in. */
  role?: 'owner' | 'editor' | 'viewer';
  /** How many people can see it, including the owner. */
  members?: number;
  /** Set when the vault is end-to-end encrypted. Only ever with a PIN. */
  encryption?: VaultEncryption | null;
}
