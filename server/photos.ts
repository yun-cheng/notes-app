import type { Context, Hono } from 'hono';
import { SHARED_WITH } from './access';
import type { AppEnv } from './db';
import {
  disconnect,
  downloadFile,
  DriveFailed,
  DriveNotConnected,
  driveStatus,
  finishConnect,
  startConnect,
  uploadFile,
  type DriveConfig,
  type GoogleFetch,
} from './drive';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif' };

function driveConfig(c: Context<AppEnv>, fetcher: GoogleFetch): DriveConfig | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = c.env;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${new URL(c.req.url).origin}/api/drive/callback`, fetch: fetcher };
}

function driveError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof DriveNotConnected) return c.json({ error: 'drive_not_connected' }, 409);
  if (err instanceof DriveFailed) {
    console.error(err);
    return c.json({ error: 'drive_failed' }, 502);
  }
  throw err;
}

/** Google redirects here after the user approves Drive access. There is no session cookie on this request. */
export function drivePublicRoutes(app: Hono<AppEnv>, fetcher: GoogleFetch, now: () => number) {
  app.get('/drive/callback', async (c) => {
    const back = (result: string) => c.redirect(`/settings?drive=${result}`, 302);
    const config = driveConfig(c, fetcher);
    const { code, state, error } = c.req.query();
    if (!config || error || !code || !state) return back(error === 'access_denied' ? 'denied' : 'failed');
    try {
      return back((await finishConnect(c.env.DB, config, state, code, now())) ? 'connected' : 'expired');
    } catch (err) {
      if (!(err instanceof DriveFailed)) throw err;
      console.error(err);
      return back('failed');
    }
  });
}

interface AttachmentRow {
  id: string;
  owner_id: string;
  vault_id: string;
  drive_file_id: string;
  mime: string;
}

export function photoRoutes(app: Hono<AppEnv>, fetcher: GoogleFetch, now: () => number) {
  app.get('/drive', async (c) => c.json({ configured: !!driveConfig(c, fetcher), ...(await driveStatus(c.env.DB, c.get('user').id)) }));

  app.post('/drive/connect', async (c) => {
    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    return c.json({ url: await startConnect(c.env.DB, config, c.get('user').id, now()) });
  });

  app.delete('/drive', async (c) => {
    await disconnect(c.env.DB, driveConfig(c, fetcher), c.get('user').id);
    return c.json({ ok: true });
  });

  /** Uploads a photo into the vault owner's Drive. Repeating an upload that already landed is fine. */
  app.put('/attachments/:id', async (c) => {
    const id = c.req.param('id');
    const vaultId = c.req.query('vault') ?? '';
    const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!/^[\w-]{8,64}$/.test(id) || !IMAGE_TYPES[mime]) return c.json({ error: 'Invalid photo' }, 400);

    const vault = await c.env.DB.prepare(
      `SELECT v.owner_id FROM vaults v JOIN vault_members m ON m.vault_id = v.id WHERE v.id = ? AND m.user_id = ? AND m.role IN ('owner', 'editor')`,
    )
      .bind(vaultId, c.get('user').id)
      .first<{ owner_id: string }>();
    if (!vault) return c.json({ error: 'Vault not found' }, 404);

    const existing = await c.env.DB.prepare(`SELECT vault_id FROM attachments WHERE id = ?`).bind(id).first<{ vault_id: string }>();
    if (existing) return existing.vault_id === vaultId ? c.json({ id }) : c.json({ error: 'Photo exists in another vault' }, 409);

    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    const bytes = await c.req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) return c.json({ error: 'Photo too large' }, 413);
    const size = (key: string) => {
      const n = Number(c.req.query(key));
      return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
    };
    try {
      const at = now();
      const fileId = await uploadFile(c.env.DB, config, vault.owner_id, { name: `${id}.${IMAGE_TYPES[mime]}`, mime, bytes }, at);
      await c.env.DB.prepare(
        `INSERT INTO attachments (id, owner_id, vault_id, drive_file_id, mime, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
        .bind(id, vault.owner_id, vaultId, fileId, mime, bytes.byteLength, size('w'), size('h'), at)
        .run();
      return c.json({ id }, 201);
    } catch (err) {
      return driveError(c, err);
    }
  });

  /** Streams a photo from the owner's Drive to any member of its vault. */
  app.get('/attachments/:id', async (c) => {
    const userId = c.get('user').id;
    // Members of its vault see a photo, and so do people a card holding it was shared with.
    const row = await c.env.DB.prepare(
      `SELECT a.id, a.owner_id, a.vault_id, a.drive_file_id, a.mime FROM attachments a
       WHERE a.id = ?
         AND (a.vault_id IN (SELECT vault_id FROM vault_members WHERE user_id = ?)
              OR EXISTS (SELECT 1 FROM cards c JOIN card_shares s ON s.card_id = c.id
                         WHERE c.vault_id = a.vault_id AND instr(c.payload, a.id) > 0 AND ${SHARED_WITH}))`,
    )
      .bind(c.req.param('id'), userId, userId, userId)
      .first<AttachmentRow>();
    if (!row) return c.json({ error: 'Photo not found' }, 404);
    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    try {
      const file = await downloadFile(c.env.DB, config, row.owner_id, row.drive_file_id, now());
      // A photo never changes under its ID, so devices may keep it.
      return new Response(file.body, { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable' } });
    } catch (err) {
      return driveError(c, err);
    }
  });
}
