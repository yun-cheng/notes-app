import type { Hono } from 'hono';
import type { AppEnv, Database } from './db';

export type MemberRole = 'editor' | 'viewer';

export interface Member {
  user_id: string;
  name: string;
  email: string;
  role: 'owner' | MemberRole;
}

export interface VaultPeople {
  members: Member[];
  /** Invited by email, not signed in yet. */
  invites: { email: string; role: MemberRole }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function roleIn(db: Database, vaultId: string, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT role FROM vault_members WHERE vault_id = ? AND user_id = ?`).bind(vaultId, userId).first<{ role: string }>();
  return row?.role ?? null;
}

export async function vaultPeople(db: Database, vaultId: string): Promise<VaultPeople> {
  const [members, invites] = await Promise.all([
    db
      .prepare(
        `SELECT u.id AS user_id, u.name, u.email, m.role FROM vault_members m JOIN users u ON u.id = m.user_id
         WHERE m.vault_id = ? ORDER BY m.role = 'owner' DESC, u.name`,
      )
      .bind(vaultId)
      .all<Member>(),
    db.prepare(`SELECT email, role FROM vault_invites WHERE vault_id = ? ORDER BY email`).bind(vaultId).all<{ email: string; role: MemberRole }>(),
  ]);
  return { members: members.results, invites: invites.results };
}

/** Sharing a whole vault: its owner adds people by email as editors or viewers. Anyone may leave. */
export function memberRoutes(app: Hono<AppEnv>, now: () => number) {
  app.get('/vaults/:id/members', async (c) => {
    const vaultId = c.req.param('id');
    if (!(await roleIn(c.env.DB, vaultId, c.get('user').id))) return c.json({ error: 'Vault not found' }, 404);
    return c.json(await vaultPeople(c.env.DB, vaultId));
  });

  /** Adds someone, or changes their role. Someone without an account yet is invited, and joins at first sign-in. */
  app.post('/vaults/:id/members', async (c) => {
    const vaultId = c.req.param('id');
    const me = c.get('user');
    const vault = await c.env.DB.prepare(`SELECT owner_id, lock FROM vaults WHERE id = ?`).bind(vaultId).first<{ owner_id: string; lock: string }>();
    if (!vault || vault.owner_id !== me.id) return c.json({ error: 'Vault not found' }, 404);
    if (vault.lock !== 'none') return c.json({ error: 'A private vault cannot be shared' }, 400);
    const body = await c.req.json<{ email?: unknown; role?: unknown }>().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body?.role;
    if (!EMAIL.test(email) || email.length > 200 || (role !== 'editor' && role !== 'viewer')) return c.json({ error: 'Give an email address and a role' }, 400);
    if (email === me.email.toLowerCase()) return c.json({ error: 'You already own this vault' }, 400);

    const user = await c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = ?`).bind(email).first<{ id: string }>();
    if (user) {
      await c.env.DB.prepare(
        `INSERT INTO vault_members (vault_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(vault_id, user_id) DO UPDATE SET role = excluded.role`,
      )
        .bind(vaultId, user.id, role)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO vault_invites (vault_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(vault_id, email) DO UPDATE SET role = excluded.role`,
      )
        .bind(vaultId, email, role, me.id, now())
        .run();
    }
    return c.json(await vaultPeople(c.env.DB, vaultId));
  });

  /** The owner removes someone, or a member leaves. The owner can't leave their own vault. */
  app.delete('/vaults/:id/members/:userId', async (c) => {
    const vaultId = c.req.param('id');
    const target = c.req.param('userId');
    const me = c.get('user').id;
    const [mine, theirs] = await Promise.all([roleIn(c.env.DB, vaultId, me), roleIn(c.env.DB, vaultId, target)]);
    if (!mine || !theirs || theirs === 'owner' || (target !== me && mine !== 'owner')) return c.json({ error: 'Member not found' }, 404);
    await c.env.DB.prepare(`DELETE FROM vault_members WHERE vault_id = ? AND user_id = ?`).bind(vaultId, target).run();
    return c.json(target === me ? { ok: true } : await vaultPeople(c.env.DB, vaultId));
  });

  app.delete('/vaults/:id/invites/:email', async (c) => {
    const vaultId = c.req.param('id');
    if ((await roleIn(c.env.DB, vaultId, c.get('user').id)) !== 'owner') return c.json({ error: 'Vault not found' }, 404);
    await c.env.DB.prepare(`DELETE FROM vault_invites WHERE vault_id = ? AND email = ?`).bind(vaultId, c.req.param('email').toLowerCase()).run();
    return c.json(await vaultPeople(c.env.DB, vaultId));
  });
}
