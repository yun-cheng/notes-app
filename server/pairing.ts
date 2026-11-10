import type { Context, Hono } from 'hono';
import type { SessionInfo } from '../src/sync/protocol';
import { createSession, hashToken, randomToken } from './auth';
import type { AppEnv } from './db';
import { listVaults } from './vaults';

const TTL = 10 * 60_000;
/** No 0/O or 1/I, so the code reads unambiguously. */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function shortCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => LETTERS[b % LETTERS.length]).join('');
}

async function pairing(c: Context<AppEnv>, pair: unknown, now: number) {
  if (typeof pair !== 'string' || pair.length > 100) return null;
  return c.env.DB.prepare(`SELECT pair_hash, code, user_id FROM device_pairings WHERE pair_hash = ? AND expires_at > ?`)
    .bind(await hashToken(pair), now)
    .first<{ pair_hash: string; code: string; user_id: string | null }>();
}

/** Routes the app calls before it has a session. */
export function pairingPublicRoutes(app: Hono<AppEnv>, sendSession: (c: Context<AppEnv>, token: string) => void, now: () => number) {
  app.post('/auth/pair/start', async (c) => {
    const pair = randomToken();
    const code = shortCode();
    await c.env.DB.prepare(`INSERT INTO device_pairings (pair_hash, code, user_id, expires_at) VALUES (?, ?, NULL, ?)`)
      .bind(await hashToken(pair), code, now() + TTL)
      .run();
    return c.json({ pair, code });
  });

  /** Called by the app every couple of seconds until the browser has approved it. */
  app.post('/auth/pair/claim', async (c) => {
    const body = await c.req.json<{ pair?: unknown }>().catch(() => null);
    const at = now();
    const row = await pairing(c, body?.pair, at);
    if (!row) return c.json({ error: 'expired' }, 404);
    if (!row.user_id) return c.json({ pending: true }, 202);
    const user = await c.env.DB.prepare(`DELETE FROM device_pairings WHERE pair_hash = ? RETURNING user_id`).bind(row.pair_hash).first<{ user_id: string }>();
    if (!user) return c.json({ error: 'expired' }, 404);
    const account = await c.env.DB.prepare(`SELECT id, email, name FROM users WHERE id = ?`).bind(user.user_id).first<SessionInfo['user']>();
    if (!account) return c.json({ error: 'expired' }, 404);
    sendSession(c, await createSession(c.env.DB, account.id, at));
    return c.json<SessionInfo>({ user: account, vaults: await listVaults(c.env.DB, account.id) });
  });
}

/** Routes the signed-in browser calls to approve the app. */
export function pairingSessionRoutes(app: Hono<AppEnv>, now: () => number) {
  app.get('/auth/pair/code', async (c) => {
    const row = await pairing(c, c.req.query('pair'), now());
    return row && !row.user_id ? c.json({ code: row.code }) : c.json({ error: 'expired' }, 404);
  });

  app.post('/auth/pair/approve', async (c) => {
    const body = await c.req.json<{ pair?: unknown }>().catch(() => null);
    const row = await pairing(c, body?.pair, now());
    if (!row || row.user_id) return c.json({ error: 'expired' }, 404);
    await c.env.DB.prepare(`UPDATE device_pairings SET user_id = ? WHERE pair_hash = ?`).bind(c.get('user').id, row.pair_hash).run();
    return c.json({ ok: true });
  });
}
