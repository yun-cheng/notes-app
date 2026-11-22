import type { Context, Hono } from 'hono';
import { isTimeKey } from '../src/domain/dates';
import { parsePayload } from '../src/domain/payload';
import { dueKey, fireAt, LATE, notification, reminderOf, type Reminder, type ReminderSettings } from '../src/domain/reminders';
import type { CardRecord } from '../src/domain/types';
import { writableVault } from './access';
import type { AppEnv, Bindings, Database } from './db';
import { b64url, validVapidKeys, webPushSender, type PushTarget, type SendPush, type VapidKeys } from './webpush';

/**
 * Due-date reminders. A browser that asks for them leaves a push subscription here, with its time zone and when it
 * wants them. As cards are pushed, open todos with a due date are noted (`syncReminders`); every few minutes the
 * scheduled run sends each one that's come due to the browsers of the people who can change it (`sendReminders`):
 * at its due time (or some minutes before), or for a todo with only a date, at a set time that day. The server
 * can't read an encrypted vault, so a device with it open works out its reminders and seals each for each browser
 * (src/reminders/sealed.ts), and the server sends those as they are (`sealed_reminders`).
 */

export { fireAt, localInstant, notification, reminderOf } from '../src/domain/reminders';

const DAY = 86_400_000;
/** How many browsers one account can have reminders on. */
const MAX_SUBSCRIPTIONS = 20;
/** How many sealed reminders a device may leave for one vault at once: the nearest, as it sends them. */
export const MAX_SEALED = 500;
/** A sealed notification, base64url: a reminder's few hundred bytes, with room to spare. */
const MAX_SEALED_BODY = 6000;

/** Keeps the reminders in step with cards just written: noted, changed, or gone. */
export async function syncReminders(db: Database, records: CardRecord[]): Promise<void> {
  if (!records.length) return;
  const statements = records.map((r) => {
    let reminder: Reminder | null = null;
    if (!r.deleted && !r.payload.startsWith('e1:')) {
      try {
        reminder = reminderOf(parsePayload(r.payload));
      } catch {
        // Not a card this server can read.
      }
    }
    // One the server can read now, or gone, has no sealed reminders left.
    const unsealed = r.deleted || !r.payload.startsWith('e1:') ? [db.prepare(`DELETE FROM sealed_reminders WHERE card_id = ?`).bind(r.id)] : [];
    const kept = reminder
      ? db
          .prepare(
            `INSERT INTO reminders (card_id, vault_id, title, due, due_time) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(card_id) DO UPDATE SET vault_id = excluded.vault_id, title = excluded.title, due = excluded.due, due_time = excluded.due_time`,
          )
          .bind(r.id, r.vault_id, reminder.title.slice(0, 200), reminder.due, reminder.due_time)
      : db.prepare(`DELETE FROM reminders WHERE card_id = ?`).bind(r.id);
    return [kept, ...unsealed];
  });
  await db.batch(statements.flat());
}

export const isTimeZone = (zone: unknown): zone is string => {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

interface Subscription extends PushTarget, ReminderSettings {
  id: string;
  user_id: string;
}

const dateKeyUtc = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * Sends the reminders that have come due and not been sent, to the browsers of the people who can change each todo
 * (owners and editors of its vault). A browser that's gone for good is forgotten. Gives how many were sent.
 */
export async function sendReminders(db: Database, send: SendPush, now: number): Promise<number> {
  // Due dates are local days, so the window is wide enough for any time zone.
  const { results } = await db
    .prepare(
      `SELECT r.card_id, r.title, r.due, r.due_time, s.id, s.user_id, s.endpoint, s.p256dh, s.auth, s.time_zone, s.locale, s.remind_at, s.lead_minutes
       FROM reminders r
       JOIN vault_access m ON m.vault_id = r.vault_id AND m.role != 'viewer'
       JOIN push_subscriptions s ON s.user_id = m.user_id
       WHERE r.due BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM reminders_sent x WHERE x.card_id = r.card_id AND x.subscription_id = s.id AND x.due_key = r.due || ' ' || COALESCE(r.due_time, ''))`,
    )
    .bind(dateKeyUtc(now - 2 * DAY), dateKeyUtc(now + 2 * DAY))
    .all<Reminder & Subscription & { card_id: string }>();
  let sent = 0;
  const gone = new Set<string>();
  for (const row of results) {
    if (gone.has(row.id)) continue;
    const at = fireAt(row, row);
    if (at > now || now - at > LATE) continue;
    const outcome = await send(row, notification(row.card_id, row, row));
    if (outcome === 'gone') {
      gone.add(row.id);
      continue;
    }
    // A failed send is tried again on the next run, until it's too late.
    if (outcome === 'failed') continue;
    sent++;
    await db.prepare(`INSERT OR IGNORE INTO reminders_sent (card_id, subscription_id, due_key, sent_at) VALUES (?, ?, ?, ?)`).bind(row.card_id, row.id, dueKey(row), now).run();
  }

  // Those a device sealed, for todos in an encrypted vault: sent as they are, to the browser each was sealed for, while
  // the todo is still in that vault and its owner (or an editor) still in it.
  const { results: sealed } = await db
    .prepare(
      `SELECT r.card_id, r.fire_at, r.body, s.id, s.endpoint, s.p256dh, s.auth
       FROM sealed_reminders r
       JOIN push_subscriptions s ON s.id = r.subscription_id
       JOIN vaults v ON v.id = r.vault_id AND v.encryption IS NOT NULL
       JOIN vault_access m ON m.vault_id = r.vault_id AND m.user_id = s.user_id AND m.role != 'viewer'
       JOIN cards c ON c.id = r.card_id AND c.vault_id = r.vault_id AND c.deleted = 0
       WHERE r.fire_at <= ? AND r.fire_at >= ?
         AND NOT EXISTS (SELECT 1 FROM reminders_sent x WHERE x.card_id = r.card_id AND x.subscription_id = s.id AND x.due_key = 'sealed ' || r.fire_at)`,
    )
    .bind(now, now - LATE)
    .all<PushTarget & { id: string; card_id: string; fire_at: number; body: string }>();
  for (const row of sealed) {
    if (gone.has(row.id)) continue;
    const outcome = await send(row, b64url.decode(row.body));
    if (outcome === 'gone') {
      gone.add(row.id);
      continue;
    }
    if (outcome === 'failed') continue;
    sent++;
    await db.prepare(`INSERT OR IGNORE INTO reminders_sent (card_id, subscription_id, due_key, sent_at) VALUES (?, ?, ?, ?)`).bind(row.card_id, row.id, `sealed ${row.fire_at}`, now).run();
  }
  if (gone.size) await db.batch([...gone].map((id) => db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(id)));
  return sent;
}

interface SealedBody {
  card_id?: unknown;
  subscription_id?: unknown;
  fire_at?: unknown;
  body?: unknown;
}

/**
 * Replaces the sealed reminders a device left for one encrypted vault, for this account's browsers: what it worked
 * out from the vault's todos, open on it. Only for cards in that vault, and browsers of this account.
 */
async function replaceSealed(db: Database, userId: string, vaultId: string, input: unknown): Promise<{ kept: number } | { error: string; status: 400 | 404 }> {
  const vault = await writableVault(db, vaultId, userId);
  if (!vault) return { error: 'Vault not found', status: 404 };
  if (!vault.encrypted) return { error: 'The server reminds of an open vault’s todos itself', status: 400 };
  const list = (input as { reminders?: unknown } | null)?.reminders;
  if (!Array.isArray(list) || list.length > MAX_SEALED) return { error: 'Give the reminders as a list', status: 400 };
  const [{ results: subs }, { results: cards }] = await Promise.all([
    db.prepare(`SELECT id FROM push_subscriptions WHERE user_id = ?`).bind(userId).all<{ id: string }>(),
    db.prepare(`SELECT id FROM cards WHERE vault_id = ? AND deleted = 0`).bind(vaultId).all<{ id: string }>(),
  ]);
  const mine = new Set(subs.map((s) => s.id));
  const here = new Set(cards.map((c) => c.id));
  const rows: { card_id: string; subscription_id: string; fire_at: number; body: string }[] = [];
  for (const item of list as SealedBody[]) {
    const { card_id, subscription_id, fire_at, body } = item ?? {};
    if (typeof card_id !== 'string' || typeof subscription_id !== 'string' || !Number.isSafeInteger(fire_at) || !isKey(body, MAX_SEALED_BODY)) return { error: 'Not a sealed reminder', status: 400 };
    // A card not synced yet, or a browser turned off since: left for the next time.
    if (here.has(card_id) && mine.has(subscription_id)) rows.push({ card_id, subscription_id, fire_at: fire_at as number, body });
  }
  await db.batch([
    db.prepare(`DELETE FROM sealed_reminders WHERE vault_id = ? AND subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id = ?)`).bind(vaultId, userId),
    ...rows.map((r) =>
      db
        .prepare(`INSERT OR REPLACE INTO sealed_reminders (card_id, subscription_id, vault_id, fire_at, body) VALUES (?, ?, ?, ?, ?)`)
        .bind(r.card_id, r.subscription_id, vaultId, r.fire_at, r.body),
    ),
  ]);
  return { kept: rows.length };
}

/** The server's VAPID keys, when its owner has set them. */
export function vapidKeys(env: Pick<Bindings, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY'>): VapidKeys | null {
  const keys = { publicKey: env.VAPID_PUBLIC_KEY?.trim(), privateKey: env.VAPID_PRIVATE_KEY?.trim() };
  return validVapidKeys(keys) ? keys : null;
}

/** Who sends: the app's address, as push services ask for a way to reach the sender. */
export const pushSubject = (env: Pick<Bindings, 'PUSH_SUBJECT'>) => env.PUSH_SUBJECT || 'https://notes-app.yuncheng-dev.workers.dev';

/** The scheduled run's part: send what's due, when the server can. */
export async function runReminders(env: Bindings, now: number, fetcher: typeof fetch = fetch): Promise<number> {
  const keys = vapidKeys(env);
  if (!keys) return 0;
  return sendReminders(env.DB, webPushSender(keys, pushSubject(env), () => now, fetcher), now);
}

async function subscriptionId(endpoint: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  timeZone?: unknown;
  locale?: unknown;
  remindAt?: unknown;
  lead?: unknown;
}

const LEADS = [0, 5, 10, 15, 30, 60, 120];

const isPushEndpoint = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

const isKey = (v: unknown, max: number): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]+=*$/.test(v) && v.length <= max;

/**
 * Routes for a signed-in browser: the server's public key (null until reminders are set up), keeping this browser's
 * subscription and its settings, taking it off, and a test reminder sent to every browser of this account.
 */
export function reminderRoutes(app: Hono<AppEnv>, now: () => number, fetcher?: typeof fetch) {
  app.get('/push/key', (c) => c.json({ key: vapidKeys(c.env)?.publicKey ?? null }));

  /** This account's browsers with reminders on, with the keys a device seals an encrypted vault's reminders to. */
  app.get('/push/subscriptions', async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT id, p256dh, auth, time_zone, locale, remind_at, lead_minutes FROM push_subscriptions WHERE user_id = ? ORDER BY id`)
      .bind(c.get('user').id)
      .all();
    return c.json({ subscriptions: results });
  });

  app.put('/vaults/:id/sealed-reminders', async (c) => {
    const result = await replaceSealed(c.env.DB, c.get('user').id, c.req.param('id'), await c.req.json().catch(() => null));
    return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result);
  });

  app.put('/push/subscription', async (c) => {
    const body = (await c.req.json().catch(() => null)) as SubscriptionBody | null;
    if (!body || !isPushEndpoint(body.endpoint) || !isKey(body.keys?.p256dh, 200) || !isKey(body.keys?.auth, 100)) return c.json({ error: 'Not a push subscription' }, 400);
    const zone = isTimeZone(body.timeZone) ? body.timeZone : 'UTC';
    const locale = typeof body.locale === 'string' && /^[A-Za-z0-9-]{2,35}$/.test(body.locale) ? body.locale : 'en';
    const remindAt = isTimeKey(body.remindAt) ? body.remindAt : '09:00';
    const lead = typeof body.lead === 'number' && LEADS.includes(body.lead) ? body.lead : 0;
    const user = c.get('user').id;
    const { results } = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND endpoint != ?`).bind(user, body.endpoint).all<{ n: number }>();
    if ((results[0]?.n ?? 0) >= MAX_SUBSCRIPTIONS) return c.json({ error: 'Reminders are on in too many browsers. Turn them off in one first.' }, 409);
    // A browser shared by two accounts reminds the one signed in last.
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, time_zone, locale, remind_at, lead_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, time_zone = excluded.time_zone,
         locale = excluded.locale, remind_at = excluded.remind_at, lead_minutes = excluded.lead_minutes`,
    )
      .bind(await subscriptionId(body.endpoint), user, body.endpoint, body.keys!.p256dh, body.keys!.auth, zone, locale, remindAt, lead, now())
      .run();
    return c.json({ ok: true });
  });

  app.delete('/push/subscription', async (c) => {
    const body = (await c.req.json().catch(() => null)) as SubscriptionBody | null;
    if (!body || typeof body.endpoint !== 'string') return c.json({ error: 'Which browser?' }, 400);
    await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`).bind(body.endpoint, c.get('user').id).run();
    return c.json({ ok: true });
  });

  app.post('/push/test', async (c: Context<AppEnv>) => {
    const keys = vapidKeys(c.env);
    if (!keys) return c.json({ error: 'Reminders aren’t set up on this server' }, 503);
    const send = webPushSender(keys, pushSubject(c.env), now, fetcher);
    const { results } = await c.env.DB.prepare(`SELECT * FROM push_subscriptions WHERE user_id = ?`).bind(c.get('user').id).all<Subscription>();
    let sent = 0;
    for (const sub of results) {
      const outcome = await send(sub, { title: 'Reminders are on', body: 'Due todos will show here.', url: '/calendar', tag: 'test' });
      if (outcome === 'sent') sent++;
      if (outcome === 'gone') await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(sub.id).run();
    }
    return c.json({ sent, browsers: results.length });
  });
}
