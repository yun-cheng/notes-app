import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AccountSummary, ConfigResponse, SessionInfo, SignedInAccounts } from '../src/sync/protocol';
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
import { syncRoutes } from './sync';
import { reminderRoutes } from './reminders';
import { listVaults, vaultRoutes } from './vaults';
import { versionRoutes } from './versions';
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
    // A native app signs in with the ID token its own Google account picker gives it, and asks for `token: true` to get
    // its session as a bearer token instead of a cookie.
    const body = await c.req.json<{ credential?: unknown; token?: unknown }>().catch(() => null);
    if (typeof body?.credential !== 'string') return c.json({ error: 'Missing credential' }, 400);
    try {
      const identity = await verifyGoogle(body.credential, c.env.GOOGLE_CLIENT_ID);
      const at = now();
      const user = await upsertUser(c.env.DB, identity, at);
      const session = await createSession(c.env.DB, user.id, at);
      const info: SessionInfo = { user, vaults: await listVaults(c.env.DB, user.id) };
      if (body.token === true) return c.json({ ...info, token: session });
      await sendSessionCookie(c, session);
      return c.json<SessionInfo>(info);
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

  vaultRoutes(app, now);
  syncRoutes(app, now);
  versionRoutes(app);
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
