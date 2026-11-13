import type { CardRecord, Vault } from '../domain/types';

export const PUSH_LIMIT = 40;
export const PULL_LIMIT = 200;
export const MAX_PAYLOAD_BYTES = 1_900_000;

export interface Account {
  id: string;
  email: string;
  name: string;
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
  | { id: string; status: 'retry' | 'forbidden' | 'too_large' };

export interface PushResponse {
  results: PushResult[];
}

/** A card shared with this account from outside its vaults, and the strongest role it has. */
export interface SharedCard {
  card_id: string;
  role: 'view' | 'comment' | 'edit';
  shared_by: string;
}

export interface PullResponse {
  records: CardRecord[];
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

/** What a link's page says about itself, for a preview card. Only `url` is certain. */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  /** An https image address from the page. */
  image?: string;
  site?: string;
}
