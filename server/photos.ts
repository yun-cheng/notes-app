import type { Context, Hono } from 'hono';
import { EDITABLE_VAULTS, SHARED_WITH } from './access';
import type { StoredAttachment } from '../src/domain/attachments';
import type { AppEnv } from './db';
import {
  deleteFile,
  disconnect,
  downloadFile,
  DriveFailed,
  DriveNotConnected,
  DriveRefused,
  driveStatus,
  finishConnect,
  sendPiece,
  shareFile,
  startConnect,
  startUpload,
  unshareFile,
  UploadExpired,
  uploadFile,
  type UploadProgress,
  type DriveConfig,
  type GoogleFetch,
} from './drive';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** A file of any other kind, attached to an entry as it is. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** A video, sent in pieces (`/attachments/:id/upload`). */
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
/** The most one piece of an upload carries. Drive takes each but the last in multiples of 256 KB. */
export const MAX_PIECE_BYTES = 16 * 1024 * 1024;
const largest = (mime: string) => (mime.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_FILE_BYTES);
/**
 * What sealing adds to a photo or file in an encrypted vault (`src/crypto/attachmentSeal.ts`): its header, and 16
 * bytes a MiB. The server can't tell a sealed video from a sealed file, so either may be as big as a video.
 */
export const SEALED_SLACK = 64 * 1024;
const SEALED = 'application/octet-stream';
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif' };
const MIME = /^[a-z0-9][\w.+-]*\/[\w.+-]+$/;

/**
 * Headers for sending an attachment back. A photo shows as itself; any other file only downloads, as plain bytes the
 * browser won't guess at or run, so a web page someone attached can't act as this site.
 */
export function attachmentHeaders(mime: string, cache: string): Record<string, string> {
  const base = { 'cache-control': cache, 'x-content-type-options': 'nosniff' };
  if (IMAGE_TYPES[mime]) return { ...base, 'content-type': mime };
  return { ...base, 'content-type': MIME.test(mime) ? mime : 'application/octet-stream', 'content-disposition': 'attachment', 'content-security-policy': 'sandbox' };
}

/**
 * Sends a photo or file from Drive on: all of it, or the bytes a Range header asked for (206), as a video player asks
 * for them to start at once and to skip ahead.
 */
export function sendAttachment(file: Response, mime: string, cache: string): Response {
  const headers = new Headers(attachmentHeaders(mime, cache));
  headers.set('accept-ranges', 'bytes');
  for (const name of ['content-length', 'content-range']) {
    const value = file.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(file.body, { status: file.status === 206 ? 206 : 200, headers });
}

/** A file's name as Drive keeps it: after its ID, so each is its own, with nothing in it Drive would trip on. */
const driveName = (id: string, name: string | undefined) => {
  const safe = (name ?? '').replace(/[\u0000-\u001f]/g, '').replace(/[/\\]+/g, ' ').trim().slice(0, 120);
  return safe ? `${id} ${safe}` : id;
};

export function driveConfig(c: Context<AppEnv>, fetcher: GoogleFetch): DriveConfig | null {
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

/** At most this many photos and files trashed or kept in one request. */
const MAX_STATE_CHANGES = 500;
/** The vaults the user (the next binding) can change. */
/**
 * Whether a card the server can read holds the attachment, in the journal or the Trash. One in an encrypted vault
 * can't be read here, so devices, which can, decide for those. Only cards that could: those in a vault of anyone in
 * the attachment's vault, as a card moves only between vaults its mover is in.
 */
const IN_A_CARD = `EXISTS (SELECT 1 FROM cards c WHERE c.vault_id IN (
  SELECT theirs.vault_id FROM vault_members ours JOIN vault_members theirs ON theirs.user_id = ours.user_id WHERE ours.vault_id = attachments.vault_id
) AND instr(c.payload, attachments.id) > 0)`;

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

  /** Where an upload goes: a vault the user can change, and what it says it is. Else the answer to send. */
  const uploadTarget = async (c: Context<AppEnv>) => {
    const id = c.req.param('id') ?? '';
    const vaultId = c.req.query('vault') ?? '';
    // Sealed on the device, for an encrypted vault: bytes to keep as they are, which say nothing of what they are.
    const sealed = c.req.query('sealed') === '1';
    const file = sealed || c.req.query('kind') === 'file';
    const mime = sealed ? SEALED : (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase() || (file ? SEALED : '');
    if (!/^[\w-]{8,64}$/.test(id) || !(file ? MIME.test(mime) : IMAGE_TYPES[mime])) return c.json({ error: file ? 'Invalid file' : 'Invalid photo' }, 400);
    const vault = await c.env.DB.prepare(
      `SELECT v.owner_id FROM vaults v JOIN vault_access m ON m.vault_id = v.id WHERE v.id = ? AND m.user_id = ? AND m.role IN ('owner', 'editor')`,
    )
      .bind(vaultId, c.get('user').id)
      .first<{ owner_id: string }>();
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    const existing = await c.env.DB.prepare(`SELECT vault_id FROM attachments WHERE id = ?`).bind(id).first<{ vault_id: string }>();
    if (existing) return existing.vault_id === vaultId ? c.json({ id }) : c.json({ error: 'Photo exists in another vault' }, 409);
    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    const pixels = (key: string) => {
      const n = Number(c.req.query(key));
      return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
    };
    if (sealed) return { id, vaultId, ownerId: vault.owner_id, file, sealed, mime, name: null, width: null, height: null, duration: null, config };
    const name = file ? (c.req.query('name') ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || null : null;
    // A video's length in seconds, as the device read it.
    const seconds = Number(c.req.query('d'));
    const duration = file && /^(video|audio)\//.test(mime) && Number.isFinite(seconds) && seconds > 0 && seconds < 1_000_000 ? Math.round(seconds * 1000) / 1000 : null;
    return { id, vaultId, ownerId: vault.owner_id, file, sealed, mime, name, width: pixels('w'), height: pixels('h'), duration, config };
  };

  /** Notes an uploaded photo or file, now in Drive. Repeated, the first stays. */
  const record = (
    c: Context<AppEnv>,
    a: { id: string; ownerId: string; vaultId: string; fileId: string; mime: string; size: number; width: number | null; height: number | null; duration: number | null; name: string | null; sealed: boolean },
    at: number,
  ) =>
    c.env.DB.prepare(
      `INSERT INTO attachments (id, owner_id, vault_id, drive_file_id, mime, size, width, height, duration, created_at, name, sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(a.id, a.ownerId, a.vaultId, a.fileId, a.mime, a.size, a.width, a.height, a.duration, at, a.name, a.sealed ? 1 : 0)
      .run();

  /**
   * Uploads a photo, or with `kind=file` a file of any kind, into the vault owner's Drive. Repeating an upload that
   * already landed is fine.
   */
  app.put('/attachments/:id', async (c) => {
    const target = await uploadTarget(c);
    if (target instanceof Response) return target;
    const { id, file, sealed, mime, config } = target;
    const bytes = await c.req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > (sealed ? MAX_FILE_BYTES + SEALED_SLACK : file ? MAX_FILE_BYTES : MAX_PHOTO_BYTES)) return c.json({ error: file ? 'File too large' : 'Photo too large' }, 413);
    try {
      const at = now();
      // A sealed one's Drive name is its ID alone: its own name is sealed in it.
      const name = sealed ? id : file ? driveName(id, c.req.query('name')) : `${id}.${IMAGE_TYPES[mime]}`;
      const fileId = await uploadFile(c.env.DB, config, target.ownerId, { name, mime, bytes }, at);
      await record(c, { ...target, fileId, size: bytes.byteLength }, at);
      return c.json({ id }, 201);
    } catch (err) {
      return driveError(c, err);
    }
  });

  /** An upload under way, its vault one the user can change. */
  const uploadRow = (c: Context<AppEnv>, id: string) =>
    c.env.DB.prepare(`SELECT * FROM attachment_uploads WHERE id = ? AND vault_id IN (${EDITABLE_VAULTS})`)
      .bind(id, c.get('user').id)
      .first<{ id: string; owner_id: string; vault_id: string; session_url: string; mime: string; size: number; name: string | null; width: number | null; height: number | null; duration: number | null; sealed: number }>();

  /** Where an upload stands, from Drive's answer: the next byte to send, or done (the file noted, the session dropped). */
  const progress = async (c: Context<AppEnv>, row: NonNullable<Awaited<ReturnType<typeof uploadRow>>>, got: UploadProgress) => {
    if ('next' in got) return c.json({ next: got.next });
    const at = now();
    await record(c, { id: row.id, ownerId: row.owner_id, vaultId: row.vault_id, fileId: got.fileId, mime: row.mime, size: row.size, width: row.width, height: row.height, duration: row.duration, name: row.name, sealed: !!row.sealed }, at);
    await c.env.DB.prepare(`DELETE FROM attachment_uploads WHERE id = ?`).bind(row.id).run();
    return c.json({ id: row.id }, 201);
  };

  /**
   * Starts, or picks up, an upload of a big file (a video, up to 1 GB, or any file over a few megabytes) sent in
   * pieces, `kind=file` with its `size` and name as for one sent whole. Answers with the byte to send from: 0, or as
   * far as Drive got before; or with the ID once it has it all.
   */
  app.post('/attachments/:id/upload', async (c) => {
    if (c.req.query('kind') !== 'file' && c.req.query('sealed') !== '1') return c.json({ error: 'Invalid file' }, 400);
    const target = await uploadTarget(c);
    if (target instanceof Response) return target;
    const { id, vaultId, ownerId, mime, sealed, config } = target;
    const size = Number(c.req.query('size'));
    if (!Number.isSafeInteger(size) || size <= 0) return c.json({ error: 'Invalid file' }, 400);
    if (size > (sealed ? MAX_VIDEO_BYTES + SEALED_SLACK : largest(mime))) return c.json({ error: 'File too large' }, 413);
    try {
      const at = now();
      const row = await uploadRow(c, id);
      if (row && (row.vault_id !== vaultId || row.size !== size || row.mime !== mime)) return c.json({ error: 'Upload exists for another file' }, 409);
      // One under way in a vault this account can't change is someone else's: never pointed at a new session.
      if (!row && (await c.env.DB.prepare(`SELECT 1 AS yes FROM attachment_uploads WHERE id = ?`).bind(id).first()))
        return c.json({ error: 'Upload exists for another file' }, 409);
      if (row) {
        try {
          return await progress(c, row, await sendPiece(c.env.DB, config, row.owner_id, at, row.session_url, row.size, null));
        } catch (err) {
          if (!(err instanceof UploadExpired)) throw err;
          await c.env.DB.prepare(`DELETE FROM attachment_uploads WHERE id = ?`).bind(id).run();
        }
      }
      const session = await startUpload(c.env.DB, config, ownerId, { name: sealed ? id : driveName(id, c.req.query('name')), mime, size }, at);
      await c.env.DB.prepare(
        `INSERT INTO attachment_uploads (id, owner_id, vault_id, session_url, mime, size, name, width, height, duration, created_at, sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET session_url = excluded.session_url, created_at = excluded.created_at`,
      )
        .bind(id, ownerId, vaultId, session, mime, size, target.name, target.width, target.height, target.duration, at, sealed ? 1 : 0)
        .run();
      return c.json({ next: 0 });
    } catch (err) {
      return driveError(c, err);
    }
  });

  /**
   * One piece of an upload started above, its place in `content-range` ("bytes 0-8388607/52428800"), sent on to Drive.
   * Answers with the next byte to send, the ID once Drive has it all, or `upload_expired` to start again.
   */
  app.put('/attachments/:id/upload', async (c) => {
    const row = await uploadRow(c, c.req.param('id'));
    if (!row) return c.json({ error: 'upload_expired' }, 409);
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(c.req.header('content-range') ?? '');
    const bytes = await c.req.arrayBuffer();
    const start = Number(range?.[1]);
    if (!range || Number(range[3]) !== row.size || Number(range[2]) - start + 1 !== bytes.byteLength || Number(range[2]) >= row.size) return c.json({ error: 'Invalid piece' }, 400);
    if (bytes.byteLength > MAX_PIECE_BYTES) return c.json({ error: 'Piece too large' }, 413);
    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    try {
      return await progress(c, row, await sendPiece(c.env.DB, config, row.owner_id, now(), row.session_url, row.size, { start, bytes }));
    } catch (err) {
      if (err instanceof UploadExpired) {
        await c.env.DB.prepare(`DELETE FROM attachment_uploads WHERE id = ?`).bind(row.id).run();
        return c.json({ error: 'upload_expired' }, 409);
      }
      return driveError(c, err);
    }
  });

  /**
   * Every photo and file in this account's vaults: what it is, when it came, and whether it waits in the Trash, since
   * when and from which entry. Devices compare it with what their entries hold (src/photos/keeper.ts).
   */
  app.get('/attachments', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, vault_id, mime, size, name, width, height, duration, created_at, trashed_at, trashed_from, sealed FROM attachments
       WHERE vault_id IN (SELECT vault_id FROM vault_access WHERE user_id = ?) ORDER BY created_at`,
    )
      .bind(c.get('user').id)
      .all<StoredAttachment>();
    return c.json({ attachments: results });
  });

  /**
   * What a device found: `trash`, photos and files no entry holds any more, each with the entry it was last in and a
   * file's name, if known; `keep`, ones in the Trash that an entry holds again, or put back. Only in vaults this
   * account can change. One an entry the server can read still holds isn't trashed: a device that hasn't seen the
   * latest can't send it there.
   */
  app.post('/attachments/state', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { trash?: unknown; keep?: unknown };
    const trash = (Array.isArray(body.trash) ? body.trash : []).filter((t): t is { id: string; from?: unknown; name?: unknown } => typeof t?.id === 'string');
    const keep = (Array.isArray(body.keep) ? body.keep : []).filter((id): id is string => typeof id === 'string');
    if (trash.length + keep.length > MAX_STATE_CHANGES) return c.json({ error: 'Too many at once' }, 400);
    const userId = c.get('user').id;
    const at = now();
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const statements = [
      ...trash.map((t) =>
        c.env.DB.prepare(
          `UPDATE attachments SET trashed_at = ?, trashed_from = ?, name = CASE WHEN sealed = 1 THEN NULL ELSE coalesce(name, ?) END
           WHERE id = ? AND trashed_at IS NULL AND vault_id IN (${EDITABLE_VAULTS}) AND NOT ${IN_A_CARD}`,
        ).bind(at, text(t.from, 64), text(t.name, 200), t.id, userId),
      ),
      ...keep.map((id) =>
        c.env.DB.prepare(`UPDATE attachments SET trashed_at = NULL, trashed_from = NULL WHERE id = ? AND trashed_at IS NOT NULL AND vault_id IN (${EDITABLE_VAULTS})`).bind(id, userId),
      ),
    ];
    if (statements.length) await c.env.DB.batch(statements);
    return c.json({ ok: true });
  });

  /**
   * Whether a photo, video or file is shared by its Google Drive link, and the link if so, for anyone in its vault;
   * and whether this account may share it: one who can change the vault, unless the vault is private (encrypted), whose
   * entries aren't shared or published either.
   */
  app.get('/attachments/:id/link', async (c) => {
    const userId = c.get('user').id;
    const row = await c.env.DB.prepare(
      `SELECT a.drive_link, (a.vault_id IN (${EDITABLE_VAULTS}) AND v.encryption IS NULL AND a.sealed = 0) AS can FROM attachments a JOIN vaults v ON v.id = a.vault_id
       WHERE a.id = ? AND a.vault_id IN (SELECT vault_id FROM vault_access WHERE user_id = ?)`,
    )
      .bind(userId, c.req.param('id'), userId)
      .first<{ drive_link: string | null; can: number }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ url: row.drive_link, can: !!row.can });
  });

  /** One this account may share by link (`GET /attachments/:id/link`), with its Drive file. */
  const linkable = (c: Context<AppEnv>) =>
    c.env.DB.prepare(
      `SELECT a.id, a.owner_id, a.drive_file_id FROM attachments a JOIN vaults v ON v.id = a.vault_id
       WHERE a.id = ? AND a.vault_id IN (${EDITABLE_VAULTS}) AND v.encryption IS NULL AND a.sealed = 0`,
    )
      .bind(c.req.param('id'), c.get('user').id)
      .first<{ id: string; owner_id: string; drive_file_id: string }>();

  /**
   * Shares a photo, video or file by its Google Drive link, which anyone with it can open, and answers with the link.
   * The demo's, which aren't in a Drive, have none.
   */
  app.post('/attachments/:id/link', async (c) => {
    const row = await linkable(c);
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!row.drive_file_id) return c.json({ error: 'not_in_drive' }, 409);
    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    try {
      const url = await shareFile(c.env.DB, config, row.owner_id, row.drive_file_id, now());
      await c.env.DB.prepare(`UPDATE attachments SET drive_link = ? WHERE id = ?`).bind(url, row.id).run();
      return c.json({ url });
    } catch (err) {
      if (err instanceof DriveRefused) return c.json({ error: 'drive_refused' }, 403);
      return driveError(c, err);
    }
  });

  /** Stops sharing it: its Drive link opens it for no one but those its Drive lets in. */
  app.delete('/attachments/:id/link', async (c) => {
    const row = await linkable(c);
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.drive_file_id) {
      const config = driveConfig(c, fetcher);
      if (!config) return c.json({ error: 'photos_not_configured' }, 503);
      try {
        await unshareFile(c.env.DB, config, row.owner_id, row.drive_file_id, now());
      } catch (err) {
        return driveError(c, err);
      }
    }
    await c.env.DB.prepare(`UPDATE attachments SET drive_link = NULL WHERE id = ?`).bind(row.id).run();
    return c.json({ ok: true });
  });

  /**
   * Deletes a photo or file in the Trash for good: from the owner's Drive, then from the server. Refused for one an
   * entry the server can read holds again. One with no Drive file (the demo's) is only forgotten.
   */
  app.delete('/attachments/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT owner_id, drive_file_id, trashed_at, ${IN_A_CARD} AS held FROM attachments WHERE id = ? AND vault_id IN (${EDITABLE_VAULTS})`,
    )
      .bind(id, c.get('user').id)
      .first<{ owner_id: string; drive_file_id: string; trashed_at: number | null; held: number }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    // Put back on another device a moment ago, or held by an entry again.
    if (row.trashed_at === null || row.held) return c.json({ error: 'in_use' }, 409);
    if (row.drive_file_id) {
      const config = driveConfig(c, fetcher);
      if (!config) return c.json({ error: 'photos_not_configured' }, 503);
      try {
        await deleteFile(c.env.DB, config, row.owner_id, row.drive_file_id, now());
      } catch (err) {
        return driveError(c, err);
      }
    }
    await c.env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(id).run();
    return c.json({ ok: true });
  });

  /** Streams a photo or file from the owner's Drive to any member of its vault, in part when a player asks for a range. */
  app.get('/attachments/:id', async (c) => {
    const userId = c.get('user').id;
    // Members of its vault see a photo, and so do people a card holding it was shared with.
    const row = await c.env.DB.prepare(
      `SELECT a.id, a.owner_id, a.vault_id, a.drive_file_id, a.mime FROM attachments a
       WHERE a.id = ?
         AND (a.vault_id IN (SELECT vault_id FROM vault_access WHERE user_id = ?)
              OR EXISTS (SELECT 1 FROM cards c JOIN card_shares s ON s.card_id = c.id
                         WHERE c.vault_id = a.vault_id AND instr(c.payload, a.id) > 0 AND ${SHARED_WITH}))`,
    )
      .bind(c.req.param('id'), userId, userId, userId)
      .first<AttachmentRow>();
    if (!row) return c.json({ error: 'Photo not found' }, 404);
    const config = driveConfig(c, fetcher);
    if (!config) return c.json({ error: 'photos_not_configured' }, 503);
    try {
      const file = await downloadFile(c.env.DB, config, row.owner_id, row.drive_file_id, now(), c.req.header('range'));
      // A photo never changes under its ID, so devices may keep it.
      return sendAttachment(file, row.mime, 'private, max-age=31536000, immutable');
    } catch (err) {
      return driveError(c, err);
    }
  });
}
