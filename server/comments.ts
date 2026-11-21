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
/**
 * A comment in an encrypted vault, sealed on the device with the vault key: `e1:` and base64 of a nonce, up to 5000
 * characters of up to 3 bytes each, and a tag.
 */
const MAX_SEALED = 20_100;

/** Whether a comment's body is what its card's vault takes: sealed in an encrypted vault, written out in any other. */
function fits(body: string, encrypted: boolean): boolean {
  if (encrypted) return body.length <= MAX_SEALED && /^e1:[A-Za-z0-9+/]+=*$/.test(body);
  return !!body && body.length <= MAX_BODY;
}

const homeEncrypted = async (db: Database, cardId: string) =>
  !!(await db.prepare(`SELECT 1 AS yes FROM cards c JOIN vaults v ON v.id = c.vault_id WHERE c.id = ? AND v.encryption IS NOT NULL`).bind(cardId).first());

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
         k.card_id IN (SELECT c.id FROM cards c JOIN vault_access m ON m.vault_id = c.vault_id WHERE m.user_id = ? AND c.deleted = 0)
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
    const encrypted = await homeEncrypted(c.env.DB, cardId);
    if (!fits(text, encrypted)) return c.json({ error: encrypted ? 'A comment in an encrypted vault comes sealed' : `Write 1 to ${MAX_BODY} characters` }, 400);
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

  /**
   * Every comment in a vault, for a device of someone who can change it to store again sealed with its key, or written
   * out, as its cards are: its owner's as its encryption is turned on or off, and anyone's as an entry moves into it.
   */
  app.get('/vaults/:id/comments', async (c) => {
    const vaultId = c.req.param('id');
    if (!(await writableVault(c.env.DB, vaultId, c.get('user').id))) return c.json({ error: 'Vault not found' }, 404);
    const { results } = await c.env.DB.prepare(`SELECT k.id, k.card_id, k.body FROM comments k JOIN cards c ON c.id = k.card_id WHERE c.vault_id = ? ORDER BY k.id`)
      .bind(vaultId)
      .all<{ id: string; card_id: string; body: string }>();
    return c.json({ comments: results });
  });

  app.put('/vaults/:id/comments', async (c) => {
    const vaultId = c.req.param('id');
    const vault = await writableVault(c.env.DB, vaultId, c.get('user').id);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    const body = await c.req.json<{ comments?: unknown }>().catch(() => null);
    const list = Array.isArray(body?.comments) ? (body.comments as { id?: unknown; body?: unknown }[]) : null;
    if (!list || list.length > 2000 || !list.every((k) => typeof k?.id === 'string' && typeof k.body === 'string' && fits(k.body, vault.encrypted)))
      return c.json({ error: vault.encrypted ? 'Comments in an encrypted vault come sealed' : 'Comments in this vault are written out' }, 400);
    const update = c.env.DB.prepare(`UPDATE comments SET body = ? WHERE id = ? AND card_id IN (SELECT id FROM cards WHERE vault_id = ?)`);
    if (list.length) await c.env.DB.batch(list.map((k) => update.bind(k.body as string, k.id as string, vaultId)));
    return c.json({ ok: true });
  });
}

/** A vault this account can change (as its owner or an editor let in), and whether it's encrypted. */
async function writableVault(db: Database, vaultId: string, userId: string): Promise<{ encrypted: boolean } | null> {
  const row = await db
    .prepare(`SELECT v.encryption FROM vaults v JOIN vault_access m ON m.vault_id = v.id WHERE v.id = ? AND m.user_id = ? AND m.role IN ('owner', 'editor')`)
    .bind(vaultId, userId)
    .first<{ encryption: string | null }>();
  return row ? { encrypted: !!row.encryption } : null;
}
