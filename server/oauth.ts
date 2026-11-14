import { DAY, MINUTE } from '../src/domain/dates';
import type { Account, ConnectedApp } from '../src/sync/protocol';
import { base64url, hashToken, randomToken } from './auth';
import type { Database } from './db';

/**
 * A small OAuth 2.1 server for AI apps connecting over MCP: dynamic client registration,
 * authorization codes with PKCE (S256 only), and rotating refresh tokens. Public clients only.
 */

export const CODE_TTL = 10 * MINUTE;
export const ACCESS_TTL = 60 * MINUTE;
export const REFRESH_TTL = 90 * DAY;

export interface OAuthClient {
  id: string;
  name: string;
  redirect_uris: string[];
}

export class OAuthError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_redirect_uri' | 'invalid_client_metadata',
    message: string,
  ) {
    super(message);
  }
}

/** HTTPS anywhere, plain HTTP only on this machine, or an app's own scheme. Never script or data URLs. */
export function allowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'blob:', 'vbscript:'].includes(url.protocol);
}

export async function registerClient(db: Database, input: { name?: unknown; redirect_uris?: unknown }, now: number): Promise<OAuthClient> {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === 'string' && u.length <= 500 && allowedRedirect(u))) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be HTTPS, localhost, or an app scheme');
  }
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 100) : 'AI app';
  const client: OAuthClient = { id: crypto.randomUUID(), name, redirect_uris: uris as string[] };
  await db
    .prepare(`INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)`)
    .bind(client.id, client.name, JSON.stringify(client.redirect_uris), now)
    .run();
  return client;
}

export async function getClient(db: Database, id: string): Promise<OAuthClient | null> {
  const row = await db.prepare(`SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?`).bind(id).first<{ id: string; name: string; redirect_uris: string }>();
  return row && { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[] };
}

/** The client, if `redirectUri` is one it registered. Anything else must not be redirected to. */
export async function checkClient(db: Database, clientId: string, redirectUri: string): Promise<OAuthClient> {
  const client = await getClient(db, clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client');
  if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_redirect_uri', 'redirect_uri was not registered');
  return client;
}

export async function createCode(
  db: Database,
  input: { clientId: string; userId: string; redirectUri: string; codeChallenge: string },
  now: number,
): Promise<string> {
  const code = randomToken();
  await db
    .prepare(`INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(await hashToken(code), input.clientId, input.userId, input.redirectUri, input.codeChallenge, now + CODE_TTL)
    .run();
  return code;
}

export interface Tokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

async function issueAccess(db: Database, grantId: string, now: number): Promise<{ token: string; statement: ReturnType<Database['prepare']> }> {
  const token = randomToken();
  return {
    token,
    statement: db.prepare(`INSERT INTO oauth_tokens (token_hash, grant_id, expires_at) VALUES (?, ?, ?)`).bind(await hashToken(token), grantId, now + ACCESS_TTL),
  };
}

const s256 = async (verifier: string) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

/** Trades a one-time code for tokens. Each code works once; approving an app again replaces its earlier grant. */
export async function exchangeCode(
  db: Database,
  input: { code: string; clientId: string; redirectUri: string; verifier: string },
  now: number,
): Promise<Tokens> {
  const hash = await hashToken(input.code);
  const row = await db
    .prepare(`DELETE FROM oauth_codes WHERE code_hash = ? RETURNING client_id, user_id, redirect_uri, code_challenge, expires_at`)
    .bind(hash)
    .first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: number }>();
  if (!row || row.expires_at < now) throw new OAuthError('invalid_grant', 'The code is unknown, used or expired');
  if (row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri) throw new OAuthError('invalid_grant', 'The code was issued to another client');
  if (!input.verifier || (await s256(input.verifier)) !== row.code_challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed');

  const grantId = crypto.randomUUID();
  const refresh = randomToken();
  const access = await issueAccess(db, grantId, now);
  await db.batch([
    db.prepare(`DELETE FROM oauth_grants WHERE client_id = ? AND user_id = ?`).bind(row.client_id, row.user_id),
    db
      .prepare(`INSERT INTO oauth_grants (id, client_id, user_id, created_at, refresh_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(grantId, row.client_id, row.user_id, now, await hashToken(refresh), now + REFRESH_TTL),
    access.statement,
  ]);
  return { access_token: access.token, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh };
}

/** Swaps a refresh token for new tokens. The old refresh token stops working. */
export async function refreshTokens(db: Database, input: { refreshToken: string; clientId: string }, now: number): Promise<Tokens> {
  const hash = await hashToken(input.refreshToken);
  const grant = await db
    .prepare(`SELECT id, client_id, refresh_expires_at FROM oauth_grants WHERE refresh_hash = ?`)
    .bind(hash)
    .first<{ id: string; client_id: string; refresh_expires_at: number }>();
  if (!grant || grant.refresh_expires_at < now || grant.client_id !== input.clientId) throw new OAuthError('invalid_grant', 'The refresh token is not valid');
  const refresh = randomToken();
  const access = await issueAccess(db, grant.id, now);
  const [rotated] = await db.batch<{ id: string }>([
    db
      .prepare(`UPDATE oauth_grants SET refresh_hash = ?, refresh_expires_at = ? WHERE id = ? AND refresh_hash = ? RETURNING id`)
      .bind(await hashToken(refresh), now + REFRESH_TTL, grant.id, hash),
    access.statement,
    db.prepare(`DELETE FROM oauth_tokens WHERE grant_id = ? AND expires_at < ?`).bind(grant.id, now),
  ]);
  if (!rotated.results.length) throw new OAuthError('invalid_grant', 'The refresh token was already used');
  return { access_token: access.token, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh };
}

export interface AiCaller {
  user: Account;
  grantId: string;
  /** The app's name, recorded on the versions it makes. */
  app: string;
}

export async function resolveAccessToken(db: Database, token: string, now: number): Promise<AiCaller | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, g.id AS grant_id, g.last_used_at, c.name AS app
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN oauth_clients c ON c.id = g.client_id JOIN users u ON u.id = g.user_id
       WHERE t.token_hash = ? AND t.expires_at > ?`,
    )
    .bind(await hashToken(token), now)
    .first<Account & { grant_id: string; last_used_at: number | null; app: string }>();
  if (!row) return null;
  if (!row.last_used_at || now - row.last_used_at > MINUTE) {
    await db.prepare(`UPDATE oauth_grants SET last_used_at = ? WHERE id = ?`).bind(now, row.grant_id).run();
  }
  return { user: { id: row.id, email: row.email, name: row.name }, grantId: row.grant_id, app: row.app };
}

export async function listGrants(db: Database, userId: string): Promise<ConnectedApp[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, c.name, g.created_at, g.last_used_at FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
       WHERE g.user_id = ? ORDER BY g.created_at DESC`,
    )
    .bind(userId)
    .all<ConnectedApp>();
  return results;
}

export async function revokeGrant(db: Database, userId: string, grantId: string): Promise<boolean> {
  const row = await db.prepare(`DELETE FROM oauth_grants WHERE id = ? AND user_id = ? RETURNING id`).bind(grantId, userId).first<{ id: string }>();
  return !!row;
}

/** Where to send the browser after the person approves or declines. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}
