import { b64url, encryptPayload } from '../crypto/webPush';
import { fireAt, LATE, notification, reminderOf, type ReminderSettings } from '../domain/reminders';
import type { Card, Vault } from '../domain/types';
import { fetchReminderBrowsers, putSealedReminders } from '../sync/http';

/**
 * Reminders for todos in an encrypted vault. The server can't read those todos, so a device with the vault open works
 * out when each reminds each of the account's browsers, and seals the notification for that browser alone (web push's
 * own encryption, RFC 8291). The server keeps them and sends each at its time as it is: it learns when, not what.
 * A vault's whole set goes up again whenever it changes: a todo ticked, a date moved, a browser turned on or set
 * differently. Only a device with the vault open can, so a change made while it's locked everywhere waits for that.
 */

/** A browser with reminders on, with the keys its notifications are sealed to. */
export interface ReminderBrowser extends ReminderSettings {
  id: string;
  p256dh: string;
  auth: string;
}

/** How many one vault keeps at once, the nearest first; the server takes no more. */
export const MAX_SEALED = 500;

export interface PlannedReminder {
  card_id: string;
  subscription_id: string;
  fire_at: number;
  message: ReturnType<typeof notification>;
}

/** The reminders these cards are due to send each browser, from those not yet too late, nearest first. */
export function planReminders(cards: Card[], browsers: ReminderBrowser[], now: number): PlannedReminder[] {
  const plan: PlannedReminder[] = [];
  for (const card of cards) {
    if (card.deleted) continue;
    const reminder = reminderOf(card);
    if (!reminder) continue;
    for (const browser of browsers) {
      const at = fireAt(reminder, browser);
      if (now - at > LATE) continue;
      plan.push({ card_id: card.id, subscription_id: browser.id, fire_at: at, message: notification(card.id, reminder, browser) });
    }
  }
  return plan.sort((a, b) => a.fire_at - b.fire_at || a.card_id.localeCompare(b.card_id) || a.subscription_id.localeCompare(b.subscription_id)).slice(0, MAX_SEALED);
}

/**
 * What a plan comes to, to tell when it has changed since it last went up, without keeping its titles readable on the
 * device: a hash, with the browsers' keys in it, so a browser subscribed again is sealed for anew.
 */
export async function planDigest(vaultId: string, plan: PlannedReminder[], browsers: ReminderBrowser[]): Promise<string> {
  const keys = Object.fromEntries(browsers.map((b) => [b.id, `${b.p256dh} ${b.auth}`]));
  const text = JSON.stringify([vaultId, plan.map((p) => [p.card_id, p.subscription_id, keys[p.subscription_id], p.fire_at, p.message])]);
  return b64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** Each planned reminder sealed for its browser. */
export async function sealPlan(plan: PlannedReminder[], browsers: ReminderBrowser[]) {
  const byId = new Map(browsers.map((b) => [b.id, b]));
  return Promise.all(
    plan.map(async ({ card_id, subscription_id, fire_at, message }) => {
      const browser = byId.get(subscription_id)!;
      const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(message)), browser.p256dh, browser.auth);
      return { card_id, subscription_id, fire_at, body: b64url.encode(body) };
    }),
  );
}

interface Meta {
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}

const digestKey = (vaultId: string) => `sealed-reminders:${vaultId}`;

/**
 * Brings the server's sealed reminders for these vaults (encrypted, open here, this account able to change them) up to
 * date with their cards, sending a vault's set only when it has changed. A set the server took only part of (a card
 * not synced yet) is sent again next time.
 */
export async function sealReminders(meta: Meta, vaults: Vault[], cards: Card[], now = Date.now()): Promise<void> {
  if (!vaults.length) return;
  const browsers = await fetchReminderBrowsers();
  for (const vault of vaults) {
    const plan = planReminders(
      cards.filter((c) => c.vaultId === vault.id),
      browsers,
      now,
    );
    const digest = await planDigest(vault.id, plan, browsers);
    if ((await meta.getMeta(digestKey(vault.id))) === digest) continue;
    const sealed = await sealPlan(plan, browsers);
    const { kept } = await putSealedReminders(vault.id, sealed);
    if (kept === sealed.length) await meta.setMeta(digestKey(vault.id), digest);
  }
}
