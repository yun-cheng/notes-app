import type { Hono } from 'hono';
import { DRAFT_KINDS, type DraftChange, type DraftsResponse, type ServerDraft } from '../src/sync/protocol';
import type { AppEnv } from './db';

/**
 * Drafts, kept for each account so they follow it from device to device, as a chat app's do: what's written in the
 * journal box (one for each view of the journal) or a comment box (one for each entry) but not yet sent. A device
 * sends each as it's typed and asks for those changed since it last asked at every sync. The last to arrive wins;
 * one sent or emptied stays as a NULL body for 30 days, so a device that was offline drops its copy too. A draft
 * bound for an encrypted vault never comes here: the device keeps it to itself.
 */

/** As long as `drafts.ts` on the device keeps one. */
export const DRAFT_DAYS = 30;
const MAX_KEY = 500;
/** A long note with its formatting; photos are only their IDs. */
export const MAX_DRAFT_BYTES = 256 * 1024;
/** How many one request may change: a device back online sends all it kept. */
const MAX_PER_REQUEST = 100;
/** How many one account may have, so a stray loop can't fill the database. */
export const MAX_DRAFTS = 1000;

const isChange = (d: unknown): d is DraftChange => {
  const { kind, key } = (d ?? {}) as Partial<DraftChange>;
  return typeof kind === 'string' && (DRAFT_KINDS as readonly string[]).includes(kind) && typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY && 'value' in (d as object);
};

export function draftRoutes(app: Hono<AppEnv>, now: () => number) {
  /** Those changed after `since` (all of them without it), and the time to ask from next. */
  app.get('/drafts', async (c) => {
    const since = Number(c.req.query('since') ?? 0);
    const after = Number.isFinite(since) && since > 0 ? since : 0;
    const { results } = await c.env.DB.prepare(`SELECT kind, key, body, updated_at FROM drafts WHERE user_id = ? AND updated_at > ? ORDER BY updated_at`)
      .bind(c.get('user').id, after)
      .all<{ kind: DraftChange['kind']; key: string; body: string | null; updated_at: number }>();
    const drafts: ServerDraft[] = results
      // A device asking for the first time has nothing to drop.
      .filter((r) => after || r.body !== null)
      .map((r) => ({ kind: r.kind, key: r.key, value: r.body === null ? null : (JSON.parse(r.body) as unknown), at: r.updated_at }));
    return c.json<DraftsResponse>({ drafts, at: Math.max(after, ...results.map((r) => r.updated_at)) });
  });

  /** Keeps each draft sent, or drops it for a null value; says when each arrived. */
  app.put('/drafts', async (c) => {
    const body = await c.req.json<{ drafts?: unknown }>().catch(() => null);
    const changes = body?.drafts;
    if (!Array.isArray(changes) || !changes.length || changes.length > MAX_PER_REQUEST || !changes.every(isChange)) return c.json({ error: 'Invalid drafts' }, 400);
    const bodies = changes.map((d) => (d.value === null ? null : JSON.stringify(d.value)));
    if (bodies.some((b) => b !== null && new TextEncoder().encode(b).length > MAX_DRAFT_BYTES)) return c.json({ error: 'That draft is too long to keep' }, 413);
    const user = c.get('user').id;
    const db = c.env.DB;
    if (bodies.some((b) => b !== null)) {
      const count = await db.prepare(`SELECT COUNT(*) AS n FROM drafts WHERE user_id = ? AND body IS NOT NULL`).bind(user).first<{ n: number }>();
      if ((count?.n ?? 0) + bodies.filter((b) => b !== null).length > MAX_DRAFTS) return c.json({ error: 'Too many drafts kept' }, 413);
    }
    // Each its own moment, so a device asking `since` one of them gets the rest.
    const start = now();
    await db.batch(
      changes.map((d, i) =>
        db
          .prepare(
            `INSERT INTO drafts (user_id, kind, key, body, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, kind, key) DO UPDATE SET body = excluded.body, updated_at = MAX(excluded.updated_at, drafts.updated_at + 1)`,
          )
          .bind(user, d.kind, d.key, bodies[i], start + i),
      ),
    );
    return c.json({ ok: true });
  });
}
