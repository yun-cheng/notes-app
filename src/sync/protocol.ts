import type { CardRecord, Vault } from '../domain/types';

export const PUSH_LIMIT = 40;
export const PULL_LIMIT = 200;
export const MAX_PAYLOAD_BYTES = 1_900_000;

export interface Account {
  id: string;
  email: string;
  name: string;
  /** The Google profile photo's address. Missing from a server older than photos, and for an account without one. */
  picture?: string | null;
}

/** The accounts signed in on this browser, the newest sign-in first. */
export interface SignedInAccounts {
  accounts: Account[];
}

/** What deleting an account would take: the vaults it owns, with their entries and other members, and how many vaults of other people it's in. */
export interface AccountSummary {
  vaults: { id: string; name: string; cards: number; others: number }[];
  joined: number;
}

export interface SessionInfo {
  user: Account;
  vaults: Vault[];
}

export interface ConfigResponse {
  googleClientId: string;
}

/** A record's `seq` on push is the last server version this device saw. */
export type PushResult =
  | { id: string; status: 'ok'; seq: number }
  /** Both sides changed. This device's version was newer and was saved; `loser` is what it replaced. */
  | { id: string; status: 'conflict_client_won'; seq: number; loser: CardRecord }
  /** Both sides changed. The server's version was newer and was kept. */
  | { id: string; status: 'conflict_server_won'; server: CardRecord }
  /**
   * This account may not make that change (no longer an editor, say). `server` is the card as the server has it, when
   * the account can still read it, for the device to take instead.
   */
  | { id: string; status: 'forbidden'; server?: CardRecord }
  /** `bad_clock`: the device's clock is more than a day ahead of the server's. */
  | { id: string; status: 'retry' | 'too_large' | 'bad_clock' };

export interface PushResponse {
  results: PushResult[];
}

/** A card shared with everyone in one of this account's vaults. It shows in that vault as well as its own. */
export interface VaultShare {
  card_id: string;
  vault_id: string;
}

/** What `/shared` answers. `vaults` is left out by servers from before it, and then there are none. */
export interface SharedResponse {
  cards: SharedCard[];
  vaults?: VaultShare[];
  /** Cards this account can see that have comments not yet resolved, and how many. Missing from older servers. */
  comments?: CommentCount[];
}

/** How many comments on a card are still open (not resolved). */
export interface CommentCount {
  card_id: string;
  open: number;
}

/** A card shared with this account from outside its vaults, and the strongest role it has. */
export interface SharedCard {
  card_id: string;
  role: 'view' | 'comment' | 'edit';
  shared_by: string;
}

/** An AI app the user connected, as Settings lists it. */
export interface ConnectedApp {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface PullResponse {
  records: CardRecord[];
  /** Cards that moved out of this account's reach, to remove from the device. */
  gone?: string[];
  next: number;
  more: boolean;
}

/** One entry on a card's history page. Times come from the editing device's clock. */
export interface VersionInfo {
  id: number;
  started_at: number;
  saved_at: number;
  /** Who made it, or null for a card's state from before history was kept. */
  author: string | null;
  /** The AI app that made it on the author's behalf, or null. */
  via: string | null;
}

export interface VersionsResponse {
  versions: VersionInfo[];
}

export interface VersionResponse extends VersionInfo {
  payload: string;
}

/**
 * One change in the app-wide history: a saved version of a card this account can read, with the version it
 * replaced. Payloads are as the cards store them, so an encrypted vault's are encrypted here too.
 */
export interface RecentVersion extends VersionInfo {
  card_id: string;
  /** The vault the card is in now. */
  vault_id: string;
  payload: string;
  /** Whether the card was in the Trash at this version. */
  deleted: boolean;
  /** The version before it, or null when this is the card's first. */
  before: { payload: string; deleted: boolean } | null;
  /** Made by the account asking. */
  mine: boolean;
  /**
   * For the asker's own versions made by a device that said which it was: whether that is the device asking, and
   * what the device calls itself. Null for other people's versions, AI apps, and apps that don't say.
   */
  device: { here: boolean; name: string | null } | null;
}

export interface RecentVersionsResponse {
  /** Newest first, by when they were last saved. */
  versions: RecentVersion[];
  /** Pass as `before` for the next, older page. Null when there is none. */
  next: string | null;
}

/**
 * An entry's words translated by the server, for a browser that can't on the device: the language they were in,
 * and the pieces in order. `same` when they're in that language already and there's nothing else to turn them into.
 */
export type ServerTranslation = { kind: 'done'; from: string; to: string; pieces: string[] } | { kind: 'same'; from: string };

/** What the server heard in one piece of a voice message: its words, their language, and when each stretch starts, in seconds. */
export interface ServerTranscript {
  text: string;
  language: string | null;
  cues: { start: number; text: string }[];
}

/** What a link's page says about itself, for a preview card. Only `url` is certain. */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  /** An https image address from the page. */
  image?: string;
  site?: string;
}

/** The boxes whose drafts are kept for an account: the journal box, one for each view, and a comment box, one for each entry. */
export const DRAFT_KINDS = ['journal', 'comment'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** A draft as a device sends it (`PUT /api/drafts`): `value` is the draft, or null once it's sent or emptied. */
export interface DraftChange {
  kind: DraftKind;
  key: string;
  value: unknown;
}

/** A draft as the server gives it back, with when it arrived there, by the server's clock. */
export interface ServerDraft extends DraftChange {
  at: number;
}

/** `GET /api/drafts?since=`: those changed after `since`, and the time to ask from next. */
export interface DraftsResponse {
  drafts: ServerDraft[];
  at: number;
}
