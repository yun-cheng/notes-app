import type { Context, Hono } from 'hono';
import { photoIds, walk } from '../src/domain/content';
import type { CardPayload } from '../src/domain/types';
import { allows, cardAccess, sharedWith } from './access';
import { randomToken } from './auth';
import type { AppEnv, Database } from './db';
import { downloadFile, DriveFailed, DriveNotConnected, type GoogleFetch } from './drive';

export type ShareRole = 'view' | 'comment' | 'edit';
const ROLES: ShareRole[] = ['view', 'comment', 'edit'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86_400_000;

export interface CardShares {
  people: { user_id: string; name: string; email: string; role: ShareRole }[];
  invites: { email: string; role: ShareRole }[];
  vaults: { vault_id: string; name: string; role: ShareRole; members: number }[];
  links: { token: string; created_at: number; expires_at: number | null }[];
}

export async function cardShares(db: Database, cardId: string, now: number): Promise<CardShares> {
  const [people, invites, vaults, links] = await Promise.all([
    db
      .prepare(
        `SELECT u.id AS user_id, u.name, u.email, s.role FROM card_shares s JOIN users u ON u.id = s.target_id
         WHERE s.card_id = ? AND s.target_type = 'user' ORDER BY u.name`,
      )
      .bind(cardId)
      .all<CardShares['people'][number]>(),
    db.prepare(`SELECT email, role FROM card_share_invites WHERE card_id = ? ORDER BY email`).bind(cardId).all<CardShares['invites'][number]>(),
    db
      .prepare(
        `SELECT v.id AS vault_id, v.name, s.role, (SELECT COUNT(*) FROM vault_members m WHERE m.vault_id = v.id) AS members
         FROM card_shares s JOIN vaults v ON v.id = s.target_id WHERE s.card_id = ? AND s.target_type = 'vault' ORDER BY v.name`,
      )
      .bind(cardId)
      .all<CardShares['vaults'][number]>(),
    db
      .prepare(`SELECT token, created_at, expires_at FROM public_links WHERE card_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at`)
      .bind(cardId, now)
      .all<CardShares['links'][number]>(),
  ]);
  return { people: people.results, invites: invites.results, vaults: vaults.results, links: links.results };
}

/** Only members who can edit a card's own vault may share it onward, and not yet from an encrypted vault. */
async function mayShare(c: Context<AppEnv>, cardId: string): Promise<boolean> {
  const access = await cardAccess(c.env.DB, c.get('user').id, cardId);
  if (!access?.member || !allows(access, 'write')) return false;
  const sealed = await c.env.DB.prepare(`SELECT 1 AS yes FROM cards c JOIN vaults v ON v.id = c.vault_id WHERE c.id = ? AND v.encryption IS NOT NULL`)
    .bind(cardId)
    .first();
  return !sealed;
}

interface PublicCard {
  type: CardPayload['type'];
  title: string;
  date: string | null;
  content: unknown;
  status: string | null;
  due: string | null;
  updated_at: number;
}

/** The card behind a live public link, as plain data for the read-only page. */
async function publicCard(db: Database, token: string, now: number): Promise<{ payload: CardPayload; updated_at: number; vault_id: string } | null> {
  const row = await db
    .prepare(
      `SELECT c.payload, c.updated_at, c.vault_id FROM public_links l JOIN cards c ON c.id = l.card_id
       WHERE l.token = ? AND (l.expires_at IS NULL OR l.expires_at > ?) AND c.deleted = 0`,
    )
    .bind(token, now)
    .first<{ payload: string; updated_at: number; vault_id: string }>();
  return row && { payload: JSON.parse(row.payload) as CardPayload, updated_at: row.updated_at, vault_id: row.vault_id };
}

/** Public links: no session, read only. The page itself is the app at /s/:token. */
export function publicRoutes(app: Hono<AppEnv>, googleFetch: GoogleFetch, now: () => number) {
  app.get('/public/:token', async (c) => {
    const card = await publicCard(c.env.DB, c.req.param('token'), now());
    if (!card) return c.json({ error: 'This link has expired or was turned off' }, 404);
    const p = card.payload;
    // A link's stored label is the linked card's title, which isn't shared. Leave it out.
    walk(p.content, (n) => {
      if (n.type === 'cardLink' && n.attrs) n.attrs = { ...n.attrs, label: '' };
    });
    return c.json<PublicCard>({
      type: p.type,
      title: p.title,
      date: p.type === 'diary' ? p.date : null,
      content: p.content,
      status: p.type === 'todo' ? p.status : null,
      due: p.type === 'todo' ? p.due : null,
      updated_at: card.updated_at,
    });
  });

  /** A photo in a publicly linked card, and only one that card actually contains. */
  app.get('/public/:token/photos/:photo', async (c) => {
    const at = now();
    const card = await publicCard(c.env.DB, c.req.param('token'), at);
    const photo = c.req.param('photo');
    if (!card || !photoIds(card.payload.content).includes(photo)) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare(`SELECT owner_id, drive_file_id, mime FROM attachments WHERE id = ?`)
      .bind(photo)
      .first<{ owner_id: string; drive_file_id: string; mime: string }>();
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = c.env;
    if (!row || !clientId || !clientSecret) return c.json({ error: 'Not found' }, 404);
    try {
      const config = { clientId, clientSecret, redirectUri: '', fetch: googleFetch };
      const file = await downloadFile(c.env.DB, config, row.owner_id, row.drive_file_id, at);
      return new Response(file.body, { headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=3600' } });
    } catch (err) {
      if (err instanceof DriveNotConnected || err instanceof DriveFailed) return c.json({ error: 'Not available' }, 404);
      throw err;
    }
  });
}

/** Sharing one card with people, with everyone in a vault, or with anyone who has a link. */
export function shareRoutes(app: Hono<AppEnv>, now: () => number) {
  app.get('/shared', async (c) => c.json({ cards: await sharedWith(c.env.DB, c.get('user').id) }));

  app.get('/cards/:id/shares', async (c) => {
    const cardId = c.req.param('id');
    if (!(await mayShare(c, cardId))) return c.json({ error: 'Card not found' }, 404);
    return c.json(await cardShares(c.env.DB, cardId, now()));
  });

  app.post('/cards/:id/shares', async (c) => {
    const cardId = c.req.param('id');
    const me = c.get('user');
    if (!(await mayShare(c, cardId))) return c.json({ error: 'Card not found' }, 404);
    const body = await c.req.json<{ email?: unknown; vault_id?: unknown; role?: unknown }>().catch(() => null);
    const role = body?.role as ShareRole;
    if (!ROLES.includes(role)) return c.json({ error: 'Choose view, comment or edit' }, 400);
    const db = c.env.DB;
    const at = now();

    if (typeof body?.vault_id === 'string') {
      // Only into vaults the sharer belongs to, and not the card's own vault.
      const ok = await db
        .prepare(`SELECT 1 AS ok FROM vault_members m JOIN cards c ON c.id = ? WHERE m.vault_id = ? AND m.user_id = ? AND c.vault_id != m.vault_id`)
        .bind(cardId, body.vault_id, me.id)
        .first();
      if (!ok) return c.json({ error: 'Vault not found' }, 404);
      await db
        .prepare(
          `INSERT INTO card_shares (card_id, target_type, target_id, role, shared_by, created_at) VALUES (?, 'vault', ?, ?, ?, ?)
           ON CONFLICT(card_id, target_type, target_id) DO UPDATE SET role = excluded.role`,
        )
        .bind(cardId, body.vault_id, role, me.id, at)
        .run();
    } else {
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email) || email.length > 200) return c.json({ error: 'Give an email address' }, 400);
      if (email === me.email.toLowerCase()) return c.json({ error: 'That is you' }, 400);
      const user = await db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).bind(email).first<{ id: string }>();
      await (user
        ? db
            .prepare(
              `INSERT INTO card_shares (card_id, target_type, target_id, role, shared_by, created_at) VALUES (?, 'user', ?, ?, ?, ?)
               ON CONFLICT(card_id, target_type, target_id) DO UPDATE SET role = excluded.role`,
            )
            .bind(cardId, user.id, role, me.id, at)
        : db
            .prepare(
              `INSERT INTO card_share_invites (card_id, email, role, shared_by, created_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(card_id, email) DO UPDATE SET role = excluded.role`,
            )
            .bind(cardId, email, role, me.id, at)
      ).run();
    }
    return c.json(await cardShares(db, cardId, at));
  });

  app.delete('/cards/:id/shares/:type/:target', async (c) => {
    const cardId = c.req.param('id');
    if (!(await mayShare(c, cardId))) return c.json({ error: 'Card not found' }, 404);
    const { type, target } = c.req.param();
    const db = c.env.DB;
    if (type === 'invite') await db.prepare(`DELETE FROM card_share_invites WHERE card_id = ? AND email = ?`).bind(cardId, target.toLowerCase()).run();
    else if (type === 'user' || type === 'vault') {
      await db.prepare(`DELETE FROM card_shares WHERE card_id = ? AND target_type = ? AND target_id = ?`).bind(cardId, type, target).run();
    } else return c.json({ error: 'Unknown share' }, 400);
    return c.json(await cardShares(db, cardId, now()));
  });

  app.post('/cards/:id/links', async (c) => {
    const cardId = c.req.param('id');
    if (!(await mayShare(c, cardId))) return c.json({ error: 'Card not found' }, 404);
    const body = await c.req.json<{ expires_in_days?: unknown }>().catch(() => ({}) as { expires_in_days?: unknown });
    const days = body.expires_in_days;
    if (days !== undefined && days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 3650)) {
      return c.json({ error: 'Expiry must be 1 to 3650 days, or none' }, 400);
    }
    const at = now();
    await c.env.DB.prepare(`INSERT INTO public_links (token, card_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(randomToken(), cardId, c.get('user').id, at, typeof days === 'number' ? at + days * DAY : null)
      .run();
    return c.json(await cardShares(c.env.DB, cardId, at));
  });

  app.delete('/cards/:id/links/:token', async (c) => {
    const cardId = c.req.param('id');
    if (!(await mayShare(c, cardId))) return c.json({ error: 'Card not found' }, 404);
    await c.env.DB.prepare(`DELETE FROM public_links WHERE card_id = ? AND token = ?`).bind(cardId, c.req.param('token')).run();
    return c.json(await cardShares(c.env.DB, cardId, now()));
  });
}
