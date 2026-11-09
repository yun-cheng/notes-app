import { expect } from 'vitest';
import type { CardRecord } from '../src/domain/types';
import type { PullResponse, PushResult, SessionInfo } from '../src/sync/protocol';
import { createApp } from './app';
import { InvalidGoogleToken, type VerifyGoogleToken } from './auth';
import { createTestDb } from './testDb';

export const CLIENT_ID = 'test-client';
export const DAY = 86_400_000;

export function setup() {
  const db = createTestDb();
  let clock = 1_000_000;
  const verifyGoogle: VerifyGoogleToken = async (credential) => {
    if (credential === 'bad') throw new InvalidGoogleToken('no');
    return { sub: credential, email: `${credential}@example.com`, name: credential };
  };
  const app = createApp({ verifyGoogle, now: () => clock });
  const env = { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID };
  const call = (path: string, init: RequestInit = {}, cookie?: string) =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...init.headers } }, env);
  const signIn = async (name: string) => {
    const res = await call('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: name }) });
    const info = (await res.json()) as SessionInfo;
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    return { ...info, cookie, vault: info.vaults[0].id, res };
  };
  const push = async (cookie: string, records: CardRecord[]) => {
    const res = await call('/api/sync/push', { method: 'POST', body: JSON.stringify({ records }) }, cookie);
    expect(res.status).toBe(200);
    return ((await res.json()) as { results: PushResult[] }).results;
  };
  const pull = async (cookie: string, since = 0) => (await (await call(`/api/sync/pull?since=${since}`, {}, cookie)).json()) as PullResponse;
  return { db, env, call, signIn, push, pull, advance: (ms: number) => (clock += ms) };
}

export const rec = (vault: string, id: string, over: Partial<CardRecord> = {}): CardRecord => ({
  id, vault_id: vault, updated_at: 100, deleted: false, seq: 0, payload: `payload-${id}`, ...over,
});
