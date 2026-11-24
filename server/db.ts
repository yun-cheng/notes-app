import type { Account } from '../src/sync/protocol';
import type { AiBinding } from './translate';

/** The part of Cloudflare D1 this server uses, so tests can run it against SQLite. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Database {
  prepare(sql: string): Statement;
  batch<T>(statements: Statement[]): Promise<{ results: T[] }[]>;
}

export interface Bindings {
  DB: Database;
  GOOGLE_CLIENT_ID: string;
  /** The OAuth client the Mac and iPhone apps sign in to Google with, in Apple's sign-in sheet; public, as the web's. */
  GOOGLE_APPLE_CLIENT_ID?: string;
  /** Only needed for photos: the server's side of the Google Drive connection. A secret, never in config files. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Only needed for due-date reminders: the server's VAPID key pair (base64url), set by the owner. The private one is a secret. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Who push services are told sends the reminders: the app's address, or a mailto: link. */
  PUSH_SUBJECT?: string;
  /** Workers AI, for translating where the browser can't (server/translate.ts) and transcribing voice (server/transcribe.ts). A binding, not a secret. */
  AI?: AiBinding;
}

/** Hono's environment for every route: D1 and settings, plus the signed-in user once known. */
export type AppEnv = { Bindings: Bindings; Variables: { user: Account } };
