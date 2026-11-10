import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Account } from '../src/sync/protocol';
import type { Database } from './db';
import { defaultVaultId } from './vaults';

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export type VerifyGoogleToken = (credential: string, clientId: string) => Promise<GoogleIdentity>;

export class InvalidGoogleToken extends Error {}

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function googleVerifier(keys: JWTVerifyGetKey = googleKeys): VerifyGoogleToken {
  return async (credential, clientId) => {
    try {
      const { payload } = await jwtVerify(credential, keys, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: clientId,
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) {
        throw new InvalidGoogleToken('Google account has no verified email');
      }
      return { sub: payload.sub, email: payload.email, name: typeof payload.name === 'string' ? payload.name : payload.email };
    } catch (err) {
      if (err instanceof InvalidGoogleToken) throw err;
      throw new InvalidGoogleToken('Google token failed verification');
    }
  };
}

const DAY = 86_400_000;
export const SESSION_DAYS = 90;

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Only the hash is stored, so a leaked database can't be used to sign in. */
export async function hashToken(token: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export async function upsertUser(db: Database, identity: GoogleIdentity, now: number): Promise<Account> {
  const user = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name
       RETURNING id, email, name`,
    )
    .bind(crypto.randomUUID(), identity.sub, identity.email, identity.name, now)
    .first<Account>();
  if (!user) throw new Error('Saving the user failed');

  // Derived from the user ID, so repeating a first sign-in can't create a second vault.
  const vaultId = defaultVaultId(user.id);
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO vaults (id, owner_id, name, created_at) VALUES (?, ?, 'Personal', ?)`)
      .bind(vaultId, user.id, now),
    db.prepare(`INSERT OR IGNORE INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'owner')`).bind(vaultId, user.id),
  ]);
  return user;
}

export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function createSession(db: Database, userId: string, now: number): Promise<string> {
  const token = randomToken();
  await db
    .prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await hashToken(token), userId, now + SESSION_DAYS * DAY)
    .run();
  return token;
}

export interface ResolvedSession {
  user: Account;
  /** True when the session was extended and the cookie should be sent again. */
  renewed: boolean;
}

export async function resolveSession(db: Database, token: string, now: number): Promise<ResolvedSession | null> {
  const hash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(hash, now)
    .first<Account & { expires_at: number }>();
  if (!row) return null;
  const { expires_at: expiresAt, ...user } = row;
  const renewed = expiresAt - now < (SESSION_DAYS / 2) * DAY;
  if (renewed) {
    await db.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).bind(now + SESSION_DAYS * DAY, hash).run();
  }
  return { user, renewed };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await hashToken(token)).run();
}
