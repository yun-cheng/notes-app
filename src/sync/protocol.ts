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
