import type { AnyEncryption } from '../crypto/vaultKeys';
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
  /** Kept from being changed by mistake: it opens to read until this is turned off. Missing on most cards. */
  viewOnly?: boolean;
  /** Put away: kept, searchable and linkable, but out of the journal and the todo counts until unarchived. Missing on most cards. */
  archived?: boolean;
  /**
   * Its place in a board column, set by dragging it there: lower comes first. Missing until it's dragged, when it
   * sits by `createdAt` instead. See `board.ts`.
   */
  position?: number;
  /**
   * Its pages after the first (`content`), in order, shown one at a time in the bubble with a pager. Missing or null
   * on most cards; a blank page is skipped. See `cardPages` in `content.ts`.
   */
  pages?: JSONNode[] | null;
  /**
   * Its one page after the first, from before a card could have more: read as its only page while `pages` is
   * missing, and cleared when its pages are next written.
   */
  back?: JSONNode | null;
  /**
   * Kept to start new entries from: listed under the journal's Templates filter, and out of the rest of the journal,
   * the todo counts and the calendar.
   * See `templates.ts`. Missing on most cards.
   */
  template?: boolean;
  /** Emoji reactions, each with the accounts that put it on. Missing on most cards. See `reactions.ts`. */
  reactions?: Record<string, string[]> | null;
}

export interface NoteCard extends CardCommon {
  type: 'note';
  /**
   * Set on a stack, and only there: the entries grouped in it, in their order. Its own title and text describe it.
   * See `stacks.ts`.
   */
  stack?: string[];
}
/** How a todo comes back: every N days, weeks, months or years, or every weekday (Monday to Friday, `every` 1). */
export type RepeatUnit = 'day' | 'week' | 'month' | 'year' | 'weekday';
export interface Repeat {
  unit: RepeatUnit;
  every: number;
}

export interface TodoCard extends CardCommon {
  type: 'todo';
  status: 'open' | 'done';
  /** Local date key (YYYY-MM-DD), or null for no due date. */
  due: string | null;
  /** Local time on the due date (HH:MM, 24-hour). Missing or null: any time that day. */
  dueTime?: string | null;
  /**
   * The day work on it starts (YYYY-MM-DD), on or before its due date: the calendar and the timeline show the todo
   * from then until it's due. Missing or null on most todos.
   */
  start?: string | null;
  /** Set on a repeating todo: ticking it moves `due` to the next time instead of finishing it. See `repeat.ts`. */
  repeat?: Repeat | null;
  /**
   * Open but on hold, waiting on someone or something: left out of what's due, and never overdue. Ticking it done
   * takes this off. Missing on most todos.
   */
  waiting?: boolean;
  completedAt: number | null;
}
export interface TagCard extends CardCommon {
  type: 'tag';
  /** A pinned tag appears in the sidebar and acts as a folder. */
  pinned: boolean;
  /**
   * Set on a tag group, like Priority or Topics, and never on a tag put on entries: the tags in it, in order.
   * See `tagGroups.ts`.
   */
  members?: string[];
  /** A group's rule: an entry takes one of its tags (Priority) or any number (Topics). */
  choice?: 'one' | 'many';
  /** A group whose order ranks its tags (High before Low), so the journal can sort by it. */
  ordered?: boolean;
  /**
   * Kept to its vault: offered only on entries living there, and seen by everyone in it. Without it, a tag is for
   * every vault, as tags made before 2026-11-22 and a group's are. See `tagScope.ts`.
   */
  scope?: 'vault';
}

export type Card = NoteCard | TodoCard | TagCard;
export type CardType = Card['type'];
export const CARD_TYPES: readonly CardType[] = ['note', 'todo', 'tag'];

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

export type AiAccess = 'off' | 'read' | 'write';
export type AiAccessSetting = AiAccess | 'default';

export interface Vault {
  id: string;
  name: string;
  owner_id: string;
  lock: 'none' | 'pin';
  /** Effective AI access for this vault. Private vaults are always 'off'. */
  ai_access: AiAccess;
  /** Explicit per-vault override, or null when following the owner's default AI access. */
  ai_access_override?: AiAccess | null;
  created_at: number;
  /** Set when `lock` is 'pin'. */
  pin: VaultPin | null;
  /** Left out of the app entirely until unlocked. */
  hidden: boolean;
  /** This account's role in the vault, from the server. Missing for a vault made before sign-in. */
  role?: 'owner' | 'editor' | 'viewer';
  /** How many people can see it, including the owner. */
  members?: number;
  /**
   * Set when the vault is end-to-end encrypted. Only ever with a PIN. Its owner gets the vault key wrapped under their
   * PIN and the recovery key; anyone else gets their own copy (see `MemberKey`), or `member: null` before they ask.
   */
  encryption?: AnyEncryption | null;
  /** For the owner of an encrypted vault: how many members asked for its key and wait to be let in. */
  waiting?: number;
  /**
   * Set by the owner of a vault locked by their PIN: everyone in it must lock it with a PIN of their own before they
   * see anything in it. `lock`, `pin` and `hidden` are this account's own, as each member's lock is theirs.
   */
  members_need_pin?: boolean;
  /**
   * True while this account is a member who hasn't yet set the PIN the owner asks for, or, in an encrypted vault,
   * hasn't been let in by the owner: the server sends none of its cards.
   */
  withheld?: boolean;
}
