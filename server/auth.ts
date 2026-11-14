import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { toBase64 } from '../src/domain/base64';
import { DAY } from '../src/domain/dates';
import type { Account } from '../src/sync/protocol';
import type { Database } from './db';
import { defaultVaultId, diaryVaultId } from './vaults';

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  /** The Google profile photo's address, when the account has one. */
  picture?: string | null;
}

/** Only a web address served over HTTPS is kept as a photo. */
const photoUrl = (value: unknown) => (typeof value === 'string' && value.startsWith('https://') ? value : null);

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
      return {
        sub: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : payload.email,
        picture: photoUrl(payload.picture),
      };
    } catch (err) {
      if (err instanceof InvalidGoogleToken) throw err;
      throw new InvalidGoogleToken('Google token failed verification');
    }
  };
}

export const SESSION_DAYS = 90;

export function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Only the hash is stored, so a leaked database can't be used to sign in. */
export async function hashToken(token: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export async function upsertUser(db: Database, identity: GoogleIdentity, now: number): Promise<Account> {
  const user = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
       RETURNING id, email, name, picture`,
    )
    .bind(crypto.randomUUID(), identity.sub, identity.email, identity.name, photoUrl(identity.picture), now)
    .first<Account>();
  if (!user) throw new Error('Saving the user failed');

  // Derived from the user ID, so repeating a first sign-in can't create a second vault or a second diary.
  const vaultId = defaultVaultId(user.id);
  const diaryId = diaryVaultId(user.id);
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO vaults (id, owner_id, name, created_at) VALUES (?, ?, 'Personal', ?)`)
      .bind(vaultId, user.id, now),
    db.prepare(`INSERT OR IGNORE INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'owner')`).bind(vaultId, user.id),
    // The diary, a moment younger so the default vault stays first. An account from before it existed gets it here.
    db.prepare(`INSERT OR IGNORE INTO vaults (id, owner_id, name, created_at) VALUES (?, ?, 'Diary', ?)`).bind(diaryId, user.id, now + 1),
    db.prepare(`INSERT OR IGNORE INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'owner')`).bind(diaryId, user.id),
    // Whatever was shared with this email before the account existed now belongs to it.
    db
      .prepare(`INSERT OR IGNORE INTO vault_members (vault_id, user_id, role) SELECT vault_id, ?, role FROM vault_invites WHERE email = lower(?)`)
      .bind(user.id, user.email),
    db.prepare(`DELETE FROM vault_invites WHERE email = lower(?)`).bind(user.email),
    db
      .prepare(
        `INSERT OR IGNORE INTO card_shares (card_id, target_type, target_id, role, shared_by, created_at)
         SELECT card_id, 'user', ?, role, shared_by, created_at FROM card_share_invites WHERE email = lower(?)`,
      )
      .bind(user.id, user.email),
    db.prepare(`DELETE FROM card_share_invites WHERE email = lower(?)`).bind(user.email),
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

/** A live session from this browser's cookie, which can hold several accounts. */
export interface BrowserSession {
  token: string;
  user: Account;
  expiresAt: number;
}

/** The live sessions among `tokens`, in the same order, without the expired or signed-out ones. */
export async function resolveSessions(db: Database, tokens: string[], now: number): Promise<BrowserSession[]> {
  if (!tokens.length) return [];
  const hashes = await Promise.all(tokens.map(hashToken));
  const { results } = await db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash IN (${hashes.map(() => '?').join(', ')}) AND s.expires_at > ?`,
    )
    .bind(...hashes, now)
    .all<Account & { token_hash: string; expires_at: number }>();
  const byHash = new Map(results.map(({ token_hash, expires_at, ...user }) => [token_hash, { user, expiresAt: expires_at }]));
  return tokens.flatMap((token, i) => {
    const found = byHash.get(hashes[i]);
    return found ? [{ token, ...found }] : [];
  });
}

/** Extends a session past half its life, so an account in use stays signed in. True when it did. */
export async function renewSession(db: Database, session: BrowserSession, now: number): Promise<boolean> {
  if (session.expiresAt - now >= (SESSION_DAYS / 2) * DAY) return false;
  await db.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).bind(now + SESSION_DAYS * DAY, await hashToken(session.token)).run();
  return true;
}

export async function resolveSession(db: Database, token: string, now: number): Promise<ResolvedSession | null> {
  const [session] = await resolveSessions(db, [token], now);
  return session ? { user: session.user, renewed: await renewSession(db, session, now) } : null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await hashToken(token)).run();
}
