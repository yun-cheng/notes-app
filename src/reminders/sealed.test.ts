import { describe, expect, it } from 'vitest';
import { b64url } from '../crypto/webPush';
import type { Card } from '../domain/types';
import { planDigest, planReminders, sealPlan, type ReminderBrowser } from './sealed';

const todo = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, vaultId: 'diary', updatedAt: 1, deleted: false, seq: 1, type: 'todo', title: 'Pay rent', content: { type: 'doc' }, tags: [], status: 'open', due: '2026-11-20', dueTime: '15:00', completedAt: null, createdAt: 1, ...over }) as unknown as Card;

const browser = (id: string, over: Partial<ReminderBrowser> = {}): ReminderBrowser => ({
  id,
  p256dh: 'BKey',
  auth: 'auth',
  time_zone: 'UTC',
  locale: 'en-US',
  remind_at: '09:00',
  lead_minutes: 0,
  ...over,
});

describe('reminders sealed on the device', () => {
  it('plans each open todo for each browser, at its own time, nearest first', () => {
    const now = Date.parse('2026-11-20T00:00:00Z');
    const plan = planReminders(
      [todo('t1'), todo('t2', { dueTime: null, due: '2026-11-21' }), todo('done', { status: 'done' }), todo('gone', { deleted: true })],
      [browser('a'), browser('b', { time_zone: 'Asia/Taipei', lead_minutes: 10 })],
      now,
    );
    expect(plan.map((p) => [p.card_id, p.subscription_id, new Date(p.fire_at).toISOString()])).toEqual([
      ['t1', 'b', '2026-11-20T06:50:00.000Z'],
      ['t1', 'a', '2026-11-20T15:00:00.000Z'],
      ['t2', 'b', '2026-11-21T01:00:00.000Z'],
      ['t2', 'a', '2026-11-21T09:00:00.000Z'],
    ]);
    expect(plan[1].message).toEqual({ title: 'Pay rent', body: 'Due at 3:00 PM', url: '/journal/t1', tag: 'due:t1' });
    // Hours late, it's let go.
    expect(planReminders([todo('t1')], [browser('a')], Date.parse('2026-11-20T22:00:00Z'))).toEqual([]);
  });

  it('tells a changed plan from the same one, and a browser subscribed again', async () => {
    const now = Date.parse('2026-11-20T00:00:00Z');
    const plan = planReminders([todo('t1')], [browser('a')], now);
    const same = await planDigest('diary', planReminders([todo('t1')], [browser('a')], now), [browser('a')]);
    expect(await planDigest('diary', plan, [browser('a')])).toBe(same);
    expect(await planDigest('diary', planReminders([todo('t1', { title: 'Pay the rent' })], [browser('a')], now), [browser('a')])).not.toBe(same);
    expect(await planDigest('diary', plan, [browser('a', { auth: 'new' })])).not.toBe(same);
    expect(same).not.toContain('Pay');
  });

  it('seals each for its browser alone, which can open it', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const phone = browser('phone', { p256dh: b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), auth: b64url.encode(auth) });
    const plan = planReminders([todo('t1')], [phone], Date.parse('2026-11-20T00:00:00Z'));
    const [sealed] = await sealPlan(plan, [phone]);
    expect(sealed).toMatchObject({ card_id: 't1', subscription_id: 'phone', fire_at: plan[0].fire_at });
    const opened = await openPush(b64url.decode(sealed.body), pair, auth);
    expect(JSON.parse(opened)).toEqual(plan[0].message);
  });
});

/** What a browser does with a push (RFC 8291): the reverse of `encryptPayload`, with its own private key. */
async function openPush(body: Uint8Array<ArrayBuffer>, browser: CryptoKeyPair, auth: Uint8Array<ArrayBuffer>): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const sender = body.slice(21, 21 + idLength);
  const sealed = body.slice(21 + idLength);
  const theirs = await crypto.subtle.importKey('raw', sender, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, browser.privateKey, 256));
  const mine = new Uint8Array(await crypto.subtle.exportKey('raw', browser.publicKey));
  const hkdf = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), length * 8));
  const text = new TextEncoder();
  const info = new Uint8Array([...text.encode('WebPush: info\u0000'), ...mine, ...sender]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\u0000'), 16);
  const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\u0000'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  // The last byte marks the last record.
  return new TextDecoder().decode(plain.slice(0, -1));
}
