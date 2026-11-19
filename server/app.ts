import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { VaultPin } from '../src/domain/pin';
import type { CardRecord } from '../src/domain/types';
import { PUSH_LIMIT, type AccountSummary, type ConfigResponse, type RecentVersionsResponse, type SessionInfo, type SignedInAccounts, type VersionResponse, type VersionsResponse } from '../src/sync/protocol';
import {
  createSession,
  deleteSession,
  googleVerifier,
  InvalidGoogleToken,
  renewSession,
  resolveSession,
  resolveSessions,
  SESSION_DAYS,
  type BrowserSession,
  upsertUser,
  type VerifyGoogleToken,
} from './auth';
import type { AppEnv } from './db';
import { aiPublicRoutes, aiSessionRoutes, wellKnown } from './aiApp';
import type { GoogleFetch } from './drive';
import { accountSummary, deleteAccount } from './account';
import { driveConfig, drivePublicRoutes, photoRoutes } from './photos';
import { commentRoutes } from './comments';
import { memberRoutes } from './members';
import { pairingPublicRoutes, pairingSessionRoutes } from './pairing';
import { publicRoutes, shareRoutes } from './shares';
import { pullRecords, pushRecords } from './sync';
import { reminderRoutes } from './reminders';
import { createVault, listVaults, updateVault, type VaultUpdate } from './vaults';
import { getVersion, listRecentVersions, listVersions, sealVersions, type Device } from './versions';
import { transcribeRoutes } from './transcribe';
import { translateRoutes } from './translate';
import { draftRoutes } from './drafts';
import { imageRoutes, unfurlRoutes, type WebFetch } from './unfurl';

type Env = AppEnv;

export interface AppOptions {
  verifyGoogle?: VerifyGoogleToken;
  now?: () => number;
  /** Calls to Google's token and Drive APIs, replaced in tests. */
  googleFetch?: GoogleFetch;
  /** Fetches web pages for link previews, replaced in tests. */
  webFetch?: WebFetch;
}

const COOKIE = 'session';
/**
 * A browser can be signed in to several accounts at once, like Google. The cookie holds each one's session token,
 * the newest sign-in first, joined by dots (tokens never contain one). Each request names its account in this
 * header, so two tabs on different accounts never mix; without it, the first account answers.
 */
const ACCOUNT_HEADER = 'X-Account';
const MAX_ACCOUNTS = 5;

const cookieTokens = (c: Context<Env>) => (getCookie(c, COOKIE) ?? '').split('.').filter(Boolean);

/** The native apps send their session as a bearer token; browsers send the cookie. */
function bearerToken(c: Context<Env>): string | undefined {
  const header = c.req.header('Authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() || undefined : undefined;
}

/**
 * The device a request says it comes from. A device makes up its own ID and name, and nothing rests on them but
 * how the history tells devices apart, so they're only checked for shape.
 */
function deviceOf(c: Context<Env>): Device | null {
  const id = c.req.header('X-Device-Id');
  if (!id || !/^[\w-]{8,64}$/.test(id)) return null;
  const name = (c.req.header('X-Device-Name') ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 60);
  return { id, name: name || null };
}

function isRecord(value: unknown): value is CardRecord {
  const r = value as Partial<CardRecord> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    r.id.length <= 200 &&
    typeof r.vault_id === 'string' &&
    Number.isSafeInteger(r.updated_at) &&
    typeof r.deleted === 'boolean' &&
    Number.isSafeInteger(r.seq) &&
    r.seq! >= 0 &&
    typeof r.payload === 'string'
  );
}

function isPin(value: unknown): value is VaultPin {
  const p = value as Partial<VaultPin> | null;
  return (
    !!p &&
    typeof p.salt === 'string' &&
    p.salt.length <= 200 &&
    typeof p.hash === 'string' &&
    p.hash.length <= 200 &&
    Number.isSafeInteger(p.iterations) &&
    p.iterations! >= 100_000 &&
    p.iterations! <= 10_000_000
  );
}

/** The server can't check a wrapped key, only its shape and size. */
function isEncryption(value: unknown): boolean {
  const e = value as { version?: unknown; kdf?: unknown; wrapped?: unknown; recovery?: unknown } | null;
  return (
    !!e && e.version === 1 && typeof e.kdf === 'object' && typeof e.wrapped === 'string' && typeof e.recovery === 'string' && JSON.stringify(e).length <= 4000
  );
}

/** Reads the fields of a vault create or update, or returns null if any is invalid. */
function parseVaultBody(body: Record<string, unknown> | null): VaultUpdate | null {
  if (!body) return null;
  const out: VaultUpdate = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) return null;
    out.name = body.name.trim();
  }
  if (body.pin !== undefined) {
    if (body.pin !== null && !isPin(body.pin)) return null;
    out.pin = body.pin;
  }
  if (body.ai_access !== undefined) {
    if (body.ai_access !== 'off' && body.ai_access !== 'read' && body.ai_access !== 'write') return null;
    out.ai_access = body.ai_access;
  }
  if (body.encryption !== undefined) {
    if (body.encryption !== null && !isEncryption(body.encryption)) return null;
    out.encryption = body.encryption as VaultUpdate['encryption'];
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') return null;
    out.hidden = body.hidden;
  }
  return out;
}

export function createApp({
  verifyGoogle = googleVerifier(),
  now = Date.now,
  googleFetch = (input, init) => fetch(input, init),
  webFetch = (input, init) => fetch(input, init),
}: AppOptions = {}) {
  const app = new Hono<Env>();

  const writeSessions = (c: Context<Env>, tokens: string[]) => {
    if (!tokens.length) return deleteCookie(c, COOKIE, { path: '/api' });
    setCookie(c, COOKIE, tokens.slice(0, MAX_ACCOUNTS).join('.'), {
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/api',
      maxAge: SESSION_DAYS * 86_400,
    });
  };
  /** The browser's live sessions; the cookie is rewritten without any that ended. */
  const browserSessions = async (c: Context<Env>) => {
    const tokens = cookieTokens(c);
    const live = await resolveSessions(c.env.DB, tokens, now());
    if (live.length < tokens.length) writeSessions(c, live.map((s) => s.token));
    return live;
  };
  /** Adds a new sign-in at the front, replacing any earlier session for the same account. */
  const sendSessionCookie = async (c: Context<Env>, token: string) => {
    const [added] = await resolveSessions(c.env.DB, [token], now());
    const others = (await browserSessions(c)).filter((s) => s.token !== token && s.user.id !== added?.user.id);
    await Promise.all(others.slice(MAX_ACCOUNTS - 1).map((s) => deleteSession(c.env.DB, s.token)));
    writeSessions(c, [token, ...others.map((s) => s.token)]);
  };
  /**
   * The session for the account the request names, or the first one. A video player can't send a header, so a GET
   * may name it as `?account=` instead: it only picks among the sessions the cookie already holds.
   */
  const pickSession = (sessions: BrowserSession[], c: Context<Env>) => {
    const wanted = c.req.header(ACCOUNT_HEADER) ?? (c.req.method === 'GET' ? c.req.query('account') : undefined);
    return wanted ? sessions.find((s) => s.user.id === wanted) : sessions[0];
  };

  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/config', (c) => c.json<ConfigResponse>({ googleClientId: c.env.GOOGLE_CLIENT_ID ?? '' }));

  app.post('/auth/google', async (c) => {
    if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'Sign-in is not configured' }, 503);
    const body = await c.req.json<{ credential?: unknown }>().catch(() => null);
    if (typeof body?.credential !== 'string') return c.json({ error: 'Missing credential' }, 400);
    try {
      const identity = await verifyGoogle(body.credential, c.env.GOOGLE_CLIENT_ID);
      const at = now();
      const user = await upsertUser(c.env.DB, identity, at);
      await sendSessionCookie(c, await createSession(c.env.DB, user.id, at));
      return c.json<SessionInfo>({ user, vaults: await listVaults(c.env.DB, user.id) });
    } catch (err) {
      if (err instanceof InvalidGoogleToken) return c.json({ error: 'Google sign-in failed' }, 401);
      throw err;
    }
  });

  /** Signs out of one account: the one the request names, or the first. The others stay signed in. */
  app.post('/auth/logout', async (c) => {
    const bearer = bearerToken(c);
    if (bearer) {
      await deleteSession(c.env.DB, bearer);
      return c.json<SignedInAccounts>({ accounts: [] });
    }
    const sessions = await browserSessions(c);
    const leaving = pickSession(sessions, c);
    if (leaving) await deleteSession(c.env.DB, leaving.token);
    const rest = sessions.filter((s) => s !== leaving);
    writeSessions(c, rest.map((s) => s.token));
    return c.json<SignedInAccounts>({ accounts: rest.map((s) => s.user) });
  });

  /** Every account signed in on this browser, for switching between them. */
  app.get('/auth/accounts', async (c) => c.json<SignedInAccounts>({ accounts: (await browserSessions(c)).map((s) => s.user) }));

  // AI apps authenticate with their own bearer tokens, not the session cookie.
  aiPublicRoutes(app, now);
  drivePublicRoutes(app, googleFetch, now);
  publicRoutes(app, googleFetch, now);
  pairingPublicRoutes(app, sendSessionCookie, now);

  // Everything registered after this requires a valid session.
  app.use(async (c, next) => {
    const bearer = bearerToken(c);
    if (bearer) {
      const session = await resolveSession(c.env.DB, bearer, now());
      if (!session) return c.json({ error: 'Not signed in' }, 401);
      c.set('user', session.user);
      return next();
    }
    const sessions = await browserSessions(c);
    const session = pickSession(sessions, c);
    if (!session) return c.json({ error: 'Not signed in' }, 401);
    // Sent again so the cookie lasts as long as the session.
    if (await renewSession(c.env.DB, session, now())) writeSessions(c, sessions.map((s) => s.token));
    c.set('user', session.user);
    return next();
  });

  app.get('/me', async (c) => {
    const user = c.get('user');
    return c.json<SessionInfo>({ user, vaults: await listVaults(c.env.DB, user.id) });
  });

  app.get('/account/summary', async (c) => c.json<AccountSummary>(await accountSummary(c.env.DB, c.get('user').id)));

  /**
   * Deletes the account the request is for, and everything it owns (`deleteAccount`). The body names its email,
   * so a stray request can't do it. The browser stays signed in to its other accounts.
   */
  app.post('/account/delete', async (c) => {
    const user = c.get('user');
    const body = await c.req.json<{ email?: unknown }>().catch(() => null);
    if (typeof body?.email !== 'string' || body.email.trim().toLowerCase() !== user.email.toLowerCase()) {
      return c.json({ error: 'Type this account’s email to delete it' }, 400);
    }
    await deleteAccount(c.env.DB, driveConfig(c, googleFetch), user.id);
    if (bearerToken(c)) return c.json<SignedInAccounts>({ accounts: [] });
    // Its sessions went with it, so the cookie keeps only the others.
    const rest = await browserSessions(c);
    return c.json<SignedInAccounts>({ accounts: rest.map((s) => s.user) });
  });

  app.post('/vaults', async (c) => {
    const input = parseVaultBody(await c.req.json<Record<string, unknown>>().catch(() => null));
    if (!input?.name) return c.json({ error: 'Invalid vault' }, 400);
    const vault = await createVault(
      c.env.DB,
      c.get('user').id,
      { name: input.name, pin: input.pin ?? null, hidden: input.hidden ?? false, encryption: input.encryption ?? null },
      now(),
    );
    return c.json(vault, 201);
  });

  app.patch('/vaults/:id', async (c) => {
    const update = parseVaultBody(await c.req.json<Record<string, unknown>>().catch(() => null));
    if (!update) return c.json({ error: 'Invalid vault' }, 400);
    const result = await updateVault(c.env.DB, c.get('user').id, c.req.param('id'), update);
    if ('vault' in result) return c.json(result.vault);
    if (result.error === 'not_found') return c.json({ error: 'Vault not found' }, 404);
    const messages = {
      default_vault: 'The default vault cannot be locked',
      private_ai: 'A private vault cannot give AI access',
      shared_private: 'A shared vault cannot have a PIN',
      encrypted_open: 'Remove the encryption along with the PIN',
    };
    return c.json({ error: messages[result.error] }, 400);
  });

  /** After a vault is encrypted, its history's plaintext versions are removed. */
  app.post('/vaults/:id/purge-plaintext', async (c) => {
    const vault = (await listVaults(c.env.DB, c.get('user').id)).find((v) => v.id === c.req.param('id'));
    if (!vault || vault.owner_id !== c.get('user').id || !vault.encryption) return c.json({ error: 'Vault not found' }, 404);
    await c.env.DB.prepare(
      `DELETE FROM card_versions WHERE payload NOT LIKE 'e1:%' AND card_id IN (SELECT id FROM cards WHERE vault_id = ?)`,
    )
      .bind(vault.id)
      .run();
    return c.json({ ok: true });
  });

  app.post('/sync/push', async (c) => {
    const body = await c.req.json<{ records?: unknown }>().catch(() => null);
    const records = body?.records;
    if (!Array.isArray(records) || !records.every(isRecord) || records.length === 0 || records.length > PUSH_LIMIT) {
      return c.json({ error: 'Invalid records' }, 400);
    }
    if (new Set(records.map((r) => r.id)).size !== records.length) return c.json({ error: 'Duplicate records' }, 400);
    return c.json({ results: await pushRecords(c.env.DB, c.get('user').id, records, now(), null, deviceOf(c)) });
  });

  app.get('/sync/pull', async (c) => {
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'Invalid cursor' }, 400);
    return c.json(await pullRecords(c.env.DB, c.get('user').id, since));
  });

  /** What changed lately across every card this account can read, newest first, a page at a time. */
  app.get('/versions', async (c) => {
    const page = await listRecentVersions(c.env.DB, c.get('user').id, deviceOf(c)?.id ?? null, c.req.query('before') ?? null);
    return page ? c.json<RecentVersionsResponse>(page) : c.json({ error: 'Invalid cursor' }, 400);
  });

  app.get('/cards/:id/versions', async (c) => {
    const versions = await listVersions(c.env.DB, c.get('user').id, c.req.param('id'));
    return versions ? c.json<VersionsResponse>({ versions }) : c.json({ error: 'Card not found' }, 404);
  });

  app.post('/cards/:id/versions/seal', async (c) =>
    (await sealVersions(c.env.DB, c.get('user').id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Card not found' }, 404),
  );

  app.get('/cards/:id/versions/:version', async (c) => {
    const versionId = Number(c.req.param('version'));
    if (!Number.isSafeInteger(versionId)) return c.json({ error: 'Version not found' }, 404);
    const version = await getVersion(c.env.DB, c.get('user').id, c.req.param('id'), versionId);
    return version ? c.json<VersionResponse>(version) : c.json({ error: 'Version not found' }, 404);
  });

  aiSessionRoutes(app, now);
  photoRoutes(app, googleFetch, now);
  unfurlRoutes(app, webFetch);
  imageRoutes(app, webFetch);
  translateRoutes(app, now);
  transcribeRoutes(app, now);
  memberRoutes(app, now);
  shareRoutes(app, now);
  commentRoutes(app, now);
  pairingSessionRoutes(app, now);
  reminderRoutes(app, now);
  draftRoutes(app, now);

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Server error' }, 500);
  });

  const root = new Hono<Env>();
  root.route('/.well-known', wellKnown());
  root.route('/api', app);
  return root;
}
