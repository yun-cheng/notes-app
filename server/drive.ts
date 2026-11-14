import { hashToken, randomToken } from './auth';
import type { Database } from './db';

/**
 * Photos are stored in the vault owner's Google Drive, under the drive.file scope, so the app can
 * only see files it created. The server holds the refresh token and does every Drive call, so
 * devices never handle Google tokens and members of a shared vault can see the owner's photos.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FOLDER_NAME = 'Notes app photos';
const STATE_TTL = 15 * 60_000;
/** Refresh an access token this long before Google says it expires. */
const EARLY = 60_000;

export type GoogleFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch: GoogleFetch;
}

export class DriveNotConnected extends Error {}
export class DriveFailed extends Error {}

export async function startConnect(db: Database, config: DriveConfig, userId: string, now: number): Promise<string> {
  const state = randomToken();
  await db.prepare(`INSERT INTO drive_states (state_hash, user_id, expires_at) VALUES (?, ?, ?)`).bind(await hashToken(state), userId, now + STATE_TTL).run();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: `openid email ${DRIVE_SCOPE}`,
    access_type: 'offline',
    // Google only returns a refresh token on consent, so ask every time someone connects.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part)) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
}

/** Finishes connecting after Google's redirect. Returns the user it was for, or null if the state is unknown. */
export async function finishConnect(db: Database, config: DriveConfig, state: string, code: string, now: number): Promise<string | null> {
  const row = await db
    .prepare(`DELETE FROM drive_states WHERE state_hash = ? RETURNING user_id, expires_at`)
    .bind(await hashToken(state))
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < now) return null;

  const res = await config.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }),
  });
  const tokens = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; id_token?: string };
  if (!res.ok || !tokens.refresh_token || !tokens.access_token) throw new DriveFailed('Google did not return tokens');
  if (!tokens.scope?.split(' ').includes(DRIVE_SCOPE)) throw new DriveFailed('Drive access was not granted');

  await db
    .prepare(
      `INSERT INTO drive_accounts (user_id, email, refresh_token, access_token, access_expires_at, folder_id, connected_at) VALUES (?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, access_token = excluded.access_token,
         access_expires_at = excluded.access_expires_at, connected_at = excluded.connected_at,
         -- Another Google account can't see the old account's folder: it gets its own.
         folder_id = CASE WHEN drive_accounts.email = excluded.email THEN drive_accounts.folder_id ELSE NULL END`,
    )
    .bind(row.user_id, emailFromIdToken(tokens.id_token), tokens.refresh_token, tokens.access_token, now + (tokens.expires_in ?? 3600) * 1000, now)
    .run();
  return row.user_id;
}

export async function driveStatus(db: Database, userId: string): Promise<{ connected: boolean; email: string | null }> {
  const row = await db.prepare(`SELECT email FROM drive_accounts WHERE user_id = ?`).bind(userId).first<{ email: string | null }>();
  return { connected: !!row, email: row?.email ?? null };
}

export async function disconnect(db: Database, config: DriveConfig | null, userId: string): Promise<void> {
  const row = await db.prepare(`DELETE FROM drive_accounts WHERE user_id = ? RETURNING refresh_token`).bind(userId).first<{ refresh_token: string }>();
  if (row && config) {
    // Best effort: the connection is gone from this app either way.
    await config.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.refresh_token)}`, { method: 'POST' }).catch(() => undefined);
  }
}

interface Account {
  refresh_token: string;
  access_token: string | null;
  access_expires_at: number | null;
  folder_id: string | null;
}

/** A current access token for this user's Drive, refreshing it when needed. */
async function accessToken(db: Database, config: DriveConfig, userId: string, now: number): Promise<{ token: string; account: Account }> {
  const account = await db
    .prepare(`SELECT refresh_token, access_token, access_expires_at, folder_id FROM drive_accounts WHERE user_id = ?`)
    .bind(userId)
    .first<Account>();
  if (!account) throw new DriveNotConnected('Google Drive is not connected');
  if (account.access_token && (account.access_expires_at ?? 0) - EARLY > now) return { token: account.access_token, account };

  const res = await config.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: account.refresh_token, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (body.error === 'invalid_grant') {
    // The user revoked access in their Google account.
    await db.prepare(`DELETE FROM drive_accounts WHERE user_id = ?`).bind(userId).run();
    throw new DriveNotConnected('Google Drive access was revoked');
  }
  if (!res.ok || !body.access_token) throw new DriveFailed('Refreshing the Drive token failed');
  await db
    .prepare(`UPDATE drive_accounts SET access_token = ?, access_expires_at = ? WHERE user_id = ?`)
    .bind(body.access_token, now + (body.expires_in ?? 3600) * 1000, userId)
    .run();
  return { token: body.access_token, account };
}

async function folder(db: Database, config: DriveConfig, userId: string, token: string, account: Account): Promise<string> {
  if (account.folder_id) return account.folder_id;
  const res = await config.fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !body.id) throw new DriveFailed('Creating the photos folder failed');
  // Two first uploads at once both make a folder. The first one saved is kept, and the other removed.
  const kept = await db
    .prepare(`UPDATE drive_accounts SET folder_id = coalesce(folder_id, ?) WHERE user_id = ? RETURNING folder_id`)
    .bind(body.id, userId)
    .first<{ folder_id: string }>();
  if (!kept) throw new DriveNotConnected('Drive was disconnected');
  if (kept.folder_id !== body.id) {
    await config.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  return kept.folder_id;
}

/** Uploads a file to the user's photos folder and returns its Drive ID. */
export async function uploadFile(db: Database, config: DriveConfig, userId: string, file: { name: string; mime: string; bytes: ArrayBuffer }, now: number): Promise<string> {
  const { token, account } = await accessToken(db, config, userId, now);
  const parent = await folder(db, config, userId, token, account);
  const boundary = `notes-${randomToken()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [parent] });
  const body = new Blob([
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${file.mime}\r\n\r\n`,
    file.bytes,
    `\r\n--${boundary}--`,
  ]);
  const res = await config.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body: await body.arrayBuffer(),
  });
  const result = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !result.id) throw new DriveFailed(`Drive upload failed with ${res.status}`);
  return result.id;
}

export async function downloadFile(db: Database, config: DriveConfig, userId: string, fileId: string, now: number): Promise<Response> {
  const { token } = await accessToken(db, config, userId, now);
  const res = await config.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new DriveFailed(`Drive download failed with ${res.status}`);
  return res;
}
