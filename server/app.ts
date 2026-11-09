import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Account, ConfigResponse, SessionInfo } from '../src/sync/protocol';
import {
  createSession,
  deleteSession,
  googleVerifier,
  InvalidGoogleToken,
  listVaults,
  resolveSession,
  SESSION_DAYS,
  upsertUser,
  type VerifyGoogleToken,
} from './auth';
import type { Bindings } from './db';

type Env = { Bindings: Bindings; Variables: { user: Account } };

export interface AppOptions {
  verifyGoogle?: VerifyGoogleToken;
  now?: () => number;
}

const COOKIE = 'session';

export function createApp({ verifyGoogle = googleVerifier(), now = Date.now }: AppOptions = {}) {
  const app = new Hono<Env>().basePath('/api');

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
    c.header('Cache-Control', 'no-store');
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

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Server error' }, 500);
  });

  return app;
}
