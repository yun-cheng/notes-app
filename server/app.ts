import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { VaultPin } from '../src/domain/pin';
import type { CardRecord } from '../src/domain/types';
import { PUSH_LIMIT, type ConfigResponse, type SessionInfo, type VersionResponse, type VersionsResponse } from '../src/sync/protocol';
import {
  createSession,
  deleteSession,
  googleVerifier,
  InvalidGoogleToken,
  resolveSession,
  SESSION_DAYS,
  upsertUser,
  type VerifyGoogleToken,
} from './auth';
import type { AppEnv } from './db';
import { aiPublicRoutes, aiSessionRoutes, wellKnown } from './aiApp';
import type { GoogleFetch } from './drive';
import { drivePublicRoutes, photoRoutes } from './photos';
import { commentRoutes } from './comments';
import { memberRoutes } from './members';
import { publicRoutes, shareRoutes } from './shares';
import { pullRecords, pushRecords } from './sync';
import { createVault, listVaults, updateVault, type VaultUpdate } from './vaults';
import { getVersion, listVersions, sealVersions } from './versions';

type Env = AppEnv;

export interface AppOptions {
  verifyGoogle?: VerifyGoogleToken;
  now?: () => number;
  /** Calls to Google's token and Drive APIs, replaced in tests. */
  googleFetch?: GoogleFetch;
}

const COOKIE = 'session';

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
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') return null;
    out.hidden = body.hidden;
  }
  return out;
}

export function createApp({ verifyGoogle = googleVerifier(), now = Date.now, googleFetch = (input, init) => fetch(input, init) }: AppOptions = {}) {
  const app = new Hono<Env>();

  const sendSessionCookie = (c: Context<Env>, token: string) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/api',
      maxAge: SESSION_DAYS * 86_400,
    });

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
      sendSessionCookie(c, await createSession(c.env.DB, user.id, at));
      return c.json<SessionInfo>({ user, vaults: await listVaults(c.env.DB, user.id) });
    } catch (err) {
      if (err instanceof InvalidGoogleToken) return c.json({ error: 'Google sign-in failed' }, 401);
      throw err;
    }
  });

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await deleteSession(c.env.DB, token);
    deleteCookie(c, COOKIE, { path: '/api' });
    return c.json({ ok: true });
  });

  // AI apps authenticate with their own bearer tokens, not the session cookie.
  aiPublicRoutes(app, now);
  drivePublicRoutes(app, googleFetch, now);
  publicRoutes(app, googleFetch, now);

  // Everything registered after this requires a valid session.
  app.use(async (c, next) => {
    const token = getCookie(c, COOKIE);
    const session = token ? await resolveSession(c.env.DB, token, now()) : null;
    if (!session) return c.json({ error: 'Not signed in' }, 401);
    if (session.renewed) sendSessionCookie(c, token!);
    c.set('user', session.user);
    return next();
  });

  app.get('/me', async (c) => {
    const user = c.get('user');
    return c.json<SessionInfo>({ user, vaults: await listVaults(c.env.DB, user.id) });
  });

  app.post('/vaults', async (c) => {
    const input = parseVaultBody(await c.req.json<Record<string, unknown>>().catch(() => null));
    if (!input?.name) return c.json({ error: 'Invalid vault' }, 400);
    const vault = await createVault(c.env.DB, c.get('user').id, { name: input.name, pin: input.pin ?? null, hidden: input.hidden ?? false }, now());
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
    };
    return c.json({ error: messages[result.error] }, 400);
  });

  app.post('/sync/push', async (c) => {
    const body = await c.req.json<{ records?: unknown }>().catch(() => null);
    const records = body?.records;
    if (!Array.isArray(records) || !records.every(isRecord) || records.length === 0 || records.length > PUSH_LIMIT) {
      return c.json({ error: 'Invalid records' }, 400);
    }
    if (new Set(records.map((r) => r.id)).size !== records.length) return c.json({ error: 'Duplicate records' }, 400);
    return c.json({ results: await pushRecords(c.env.DB, c.get('user').id, records) });
  });

  app.get('/sync/pull', async (c) => {
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'Invalid cursor' }, 400);
    return c.json(await pullRecords(c.env.DB, c.get('user').id, since));
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
  memberRoutes(app, now);
  shareRoutes(app, now);
  commentRoutes(app, now);

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Server error' }, 500);
  });

  const root = new Hono<Env>();
  root.route('/.well-known', wellKnown());
  root.route('/api', app);
  return root;
}
