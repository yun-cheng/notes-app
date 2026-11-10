import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './db';
import { handleMcp } from './mcp';
import {
  checkClient,
  createCode,
  exchangeCode,
  listGrants,
  OAuthError,
  redirectWith,
  refreshTokens,
  registerClient,
  resolveAccessToken,
  revokeGrant,
} from './oauth';

const origin = (c: Context) => new URL(c.req.url).origin;

/** AI apps may call these from a browser, with a bearer token rather than cookies, so any origin is fine. */
const openCors = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id'],
  exposeHeaders: ['www-authenticate', 'mcp-session-id'],
  maxAge: 86_400,
});

function oauthError(c: Context, err: unknown) {
  if (!(err instanceof OAuthError)) throw err;
  return c.json({ error: err.code, error_description: err.message }, err.code === 'invalid_client' ? 401 : 400);
}

function authorizationServer(c: Context) {
  const base = origin(c);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['notes'],
  };
}

function protectedResource(c: Context) {
  const base = origin(c);
  return { resource: `${base}/api/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], resource_name: 'Notes', scopes_supported: ['notes'] };
}

/** Discovery documents, served at the site root as OAuth and MCP clients expect. */
export function wellKnown() {
  const app = new Hono<AppEnv>();
  app.use(openCors);
  app.get('/oauth-protected-resource', (c) => c.json(protectedResource(c)));
  app.get('/oauth-protected-resource/*', (c) => c.json(protectedResource(c)));
  app.get('/oauth-authorization-server', (c) => c.json(authorizationServer(c)));
  app.get('/oauth-authorization-server/*', (c) => c.json(authorizationServer(c)));
  app.get('/openid-configuration', (c) => c.json(authorizationServer(c)));
  return app;
}

async function readParams(c: Context): Promise<Record<string, string>> {
  const type = c.req.header('content-type') ?? '';
  const raw: Record<string, unknown> = type.includes('application/json')
    ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
    : ((await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>);
  return Object.fromEntries(
    Object.entries(raw).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : typeof v === 'boolean' ? [[k, String(v)]] : [])),
  );
}

/** Routes an AI app calls without a session: registration, tokens, and MCP itself. */
export function aiPublicRoutes(app: Hono<AppEnv>, now: () => number) {
  app.use('/oauth/register', openCors);
  app.use('/oauth/token', openCors);
  app.use('/mcp', openCors);

  app.post('/oauth/register', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: 'invalid_client_metadata', error_description: 'Expected JSON' }, 400);
    try {
      const at = now();
      const client = await registerClient(c.env.DB, { name: body.client_name, redirect_uris: body.redirect_uris }, at);
      return c.json(
        {
          client_id: client.id,
          client_id_issued_at: Math.floor(at / 1000),
          client_name: client.name,
          redirect_uris: client.redirect_uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        201,
      );
    } catch (err) {
      return oauthError(c, err);
    }
  });

  app.post('/oauth/token', async (c) => {
    const p = await readParams(c);
    try {
      if (p.grant_type === 'authorization_code') {
        if (!p.code || !p.client_id || !p.redirect_uri) throw new OAuthError('invalid_request', 'code, client_id and redirect_uri are required');
        return c.json(await exchangeCode(c.env.DB, { code: p.code, clientId: p.client_id, redirectUri: p.redirect_uri, verifier: p.code_verifier ?? '' }, now()));
      }
      if (p.grant_type === 'refresh_token') {
        if (!p.refresh_token || !p.client_id) throw new OAuthError('invalid_request', 'refresh_token and client_id are required');
        return c.json(await refreshTokens(c.env.DB, { refreshToken: p.refresh_token, clientId: p.client_id }, now()));
      }
      throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
    } catch (err) {
      return oauthError(c, err);
    }
  });

  app.all('/mcp', async (c) => {
    const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const caller = token ? await resolveAccessToken(c.env.DB, token, now()) : null;
    if (!caller) {
      c.header('WWW-Authenticate', `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"`);
      return c.json({ error: 'invalid_token', error_description: 'Connect this app to your notes first' }, 401);
    }
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.body(null, 405);
    }
    const message = await c.req.json<unknown>().catch(() => undefined);
    const reply = await handleMcp(c.env.DB, caller, message, now);
    return reply === null ? c.body(null, 202) : c.json(reply);
  });
}

const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

/** Routes the app itself uses, with the person's session: approving an app, and listing or revoking apps. */
export function aiSessionRoutes(app: Hono<AppEnv>, now: () => number) {
  app.get('/oauth/client', async (c) => {
    try {
      const client = await checkClient(c.env.DB, c.req.query('client_id') ?? '', c.req.query('redirect_uri') ?? '');
      return c.json({ name: client.name, redirect_host: new URL(c.req.query('redirect_uri')!).host || c.req.query('redirect_uri') });
    } catch (err) {
      return oauthError(c, err);
    }
  });

  app.post('/oauth/authorize', async (c) => {
    const p = await readParams(c);
    try {
      await checkClient(c.env.DB, p.client_id ?? '', p.redirect_uri ?? '');
    } catch (err) {
      // Never redirect to an address the client didn't register.
      return oauthError(c, err);
    }
    const back = (params: Record<string, string | undefined>) => c.json({ redirect: redirectWith(p.redirect_uri, { ...params, state: p.state, iss: origin(c) }) });
    if (p.approve !== 'true') return back({ error: 'access_denied' });
    if (p.code_challenge_method !== 'S256' || !CHALLENGE.test(p.code_challenge ?? '')) {
      return back({ error: 'invalid_request', error_description: 'PKCE with S256 is required' });
    }
    const code = await createCode(c.env.DB, { clientId: p.client_id, userId: c.get('user').id, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge }, now());
    return back({ code });
  });

  app.get('/ai/apps', async (c) => c.json({ apps: await listGrants(c.env.DB, c.get('user').id) }));

  app.delete('/ai/apps/:id', async (c) =>
    (await revokeGrant(c.env.DB, c.get('user').id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
  );
}
