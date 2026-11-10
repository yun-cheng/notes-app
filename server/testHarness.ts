import { expect } from 'vitest';
import type { CardRecord } from '../src/domain/types';
import type { PullResponse, PushResult, SessionInfo } from '../src/sync/protocol';
import { createApp } from './app';
import type { GoogleFetch } from './drive';
import { InvalidGoogleToken, type VerifyGoogleToken } from './auth';
import { createTestDb } from './testDb';

export const CLIENT_ID = 'test-client';
export const DAY = 86_400_000;

export function setup(options: { googleFetch?: GoogleFetch; clientSecret?: string } = {}) {
  const db = createTestDb();
  let clock = 1_000_000;
  const verifyGoogle: VerifyGoogleToken = async (credential) => {
    if (credential === 'bad') throw new InvalidGoogleToken('no');
    return { sub: credential, email: `${credential}@example.com`, name: credential };
  };
  const app = createApp({ verifyGoogle, now: () => clock, googleFetch: options.googleFetch });
  const env = { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: options.clientSecret };
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

export const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function challengeFor(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Runs the whole OAuth flow an AI app goes through, approving it as the signed-in user. */
export async function connectAi(call: ReturnType<typeof setup>['call'], cookie: string, name = 'Claude') {
  const reg = (await (await call('/api/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT] }) })).json()) as {
    client_id: string;
  };
  const verifier = 'v'.repeat(20) + crypto.randomUUID();
  const approval = await call(
    '/api/oauth/authorize',
    {
      method: 'POST',
      body: JSON.stringify({
        client_id: reg.client_id,
        redirect_uri: REDIRECT,
        code_challenge: await challengeFor(verifier),
        code_challenge_method: 'S256',
        state: 'xyz',
        approve: true,
      }),
    },
    cookie,
  );
  const { redirect } = (await approval.json()) as { redirect: string };
  const code = new URL(redirect).searchParams.get('code')!;
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
  const tokens = (await (
    await call('/api/oauth/token', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  ).json()) as { access_token: string; refresh_token: string };
  return { clientId: reg.client_id, verifier, redirect, ...tokens };
}

export { challengeFor };
