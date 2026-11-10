import type { Account } from '../src/sync/protocol';

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
}

/** Hono's environment for every route: D1 and settings, plus the signed-in user once known. */
export type AppEnv = { Bindings: Bindings; Variables: { user: Account } };
