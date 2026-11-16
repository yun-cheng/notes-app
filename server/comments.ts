import type { Hono } from 'hono';
import type { CommentCount } from '../src/sync/protocol';
import { allows, cardAccess, SHARED_WITH } from './access';
import type { AppEnv, Database } from './db';

export interface Comment {
  id: string;
  author_id: string;
  author: string;
  body: string;
  created_at: number;
  resolved_at: number | null;
}

const MAX_BODY = 5000;

async function listComments(db: Database, cardId: string): Promise<Comment[]> {
  const { results } = await db
    .prepare(
      `SELECT k.id, k.author_id, u.name AS author, k.body, k.created_at, k.resolved_at FROM comments k JOIN users u ON u.id = k.author_id
       WHERE k.card_id = ? ORDER BY k.created_at, k.id`,
    )
    .bind(cardId)
    .all<Comment>();
  return results;
}

/**
 * How many open comments each card the user can see has, through its vault or a share, for the count on its card.
 * Cards with none are left out.
 */
export async function openCommentCounts(db: Database, userId: string): Promise<CommentCount[]> {
  const { results } = await db
    .prepare(
      `SELECT k.card_id, COUNT(*) AS open FROM comments k
       WHERE k.resolved_at IS NULL AND (
         k.card_id IN (SELECT c.id FROM cards c JOIN vault_members m ON m.vault_id = c.vault_id WHERE m.user_id = ? AND c.deleted = 0)
         OR k.card_id IN (SELECT s.card_id FROM card_shares s WHERE ${SHARED_WITH})
       )
       GROUP BY k.card_id ORDER BY k.card_id`,
    )
    .bind(userId, userId, userId)
    .all<CommentCount>();
  return results;
}

/** Comments on a card. Anyone who can see it reads them; viewers of its vault and those shared with comment access or more may write. */
export function commentRoutes(app: Hono<AppEnv>, now: () => number) {
  app.get('/cards/:id/comments', async (c) => {
    const cardId = c.req.param('id');
    if (!(await cardAccess(c.env.DB, c.get('user').id, cardId))) return c.json({ error: 'Card not found' }, 404);
    return c.json({ comments: await listComments(c.env.DB, cardId) });
  });

  app.post('/cards/:id/comments', async (c) => {
    const cardId = c.req.param('id');
    const me = c.get('user').id;
    if (!allows(await cardAccess(c.env.DB, me, cardId), 'comment')) return c.json({ error: 'Card not found' }, 404);
    const body = await c.req.json<{ body?: unknown }>().catch(() => null);
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > MAX_BODY) return c.json({ error: `Write 1 to ${MAX_BODY} characters` }, 400);
    await c.env.DB.prepare(`INSERT INTO comments (id, card_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), cardId, me, text, now())
      .run();
    return c.json({ comments: await listComments(c.env.DB, cardId) }, 201);
  });

  app.patch('/cards/:id/comments/:comment', async (c) => {
    const cardId = c.req.param('id');
    if (!allows(await cardAccess(c.env.DB, c.get('user').id, cardId), 'comment')) return c.json({ error: 'Card not found' }, 404);
    const body = await c.req.json<{ resolved?: unknown }>().catch(() => null);
    if (typeof body?.resolved !== 'boolean') return c.json({ error: 'Say whether it is resolved' }, 400);
    await c.env.DB.prepare(`UPDATE comments SET resolved_at = ? WHERE id = ? AND card_id = ?`)
      .bind(body.resolved ? now() : null, c.req.param('comment'), cardId)
      .run();
    return c.json({ comments: await listComments(c.env.DB, cardId) });
  });

  /** Authors delete their own comments; anyone who can edit the card may delete any. */
  app.delete('/cards/:id/comments/:comment', async (c) => {
    const cardId = c.req.param('id');
    const me = c.get('user').id;
    const access = await cardAccess(c.env.DB, me, cardId);
    if (!access) return c.json({ error: 'Card not found' }, 404);
    const sql = allows(access, 'write')
      ? c.env.DB.prepare(`DELETE FROM comments WHERE id = ? AND card_id = ?`).bind(c.req.param('comment'), cardId)
      : c.env.DB.prepare(`DELETE FROM comments WHERE id = ? AND card_id = ? AND author_id = ?`).bind(c.req.param('comment'), cardId, me);
    await sql.run();
    return c.json({ comments: await listComments(c.env.DB, cardId) });
  });
}
