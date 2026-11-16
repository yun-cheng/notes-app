import { describe, expect, it } from 'vitest';
import type { CardPayload } from '../src/domain/types';
import { fireAt, localInstant, notification, reminderOf, sendReminders } from './reminders';
import { rec, setup } from './testHarness';
import type { PushTarget } from './webpush';

const todo = (over: Partial<CardPayload> & Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'todo', title: 'Pay rent', content: { type: 'doc' }, tags: [], status: 'open', due: '2026-11-20', completedAt: null, createdAt: 1, ...over });

const subscription = (endpoint = 'https://push.example.com/a') => ({ endpoint, keys: { p256dh: 'BKey', auth: 'auth' }, timeZone: 'Asia/Taipei', locale: 'en-US', remindAt: '08:30', lead: 10 });

describe('when a reminder goes off', () => {
  it('reads a local date and time in the browser’s time zone, across a clock change', () => {
    expect(new Date(localInstant('2026-11-20', '09:00', 'Asia/Taipei')).toISOString()).toBe('2026-11-20T01:00:00.000Z');
    expect(new Date(localInstant('2026-11-20', '09:00', 'America/New_York')).toISOString()).toBe('2026-11-20T14:00:00.000Z');
    expect(new Date(localInstant('2026-07-20', '09:00', 'America/New_York')).toISOString()).toBe('2026-07-20T13:00:00.000Z');
    expect(new Date(localInstant('2026-11-01', '01:30', 'America/New_York')).toISOString()).toMatch(/^2026-11-01T0[56]:30/);
  });

  it('is the due time less the lead, or for a date alone, the time picked for those', () => {
    const sub = { time_zone: 'UTC', remind_at: '08:30', lead_minutes: 10 };
    expect(new Date(fireAt({ title: 'A', due: '2026-11-20', due_time: '15:00' }, sub)).toISOString()).toBe('2026-11-20T14:50:00.000Z');
    expect(new Date(fireAt({ title: 'A', due: '2026-11-20', due_time: null }, sub)).toISOString()).toBe('2026-11-20T08:30:00.000Z');
  });

  it('is only for an open todo with a due date, not waiting, archived or a template', () => {
    const base = JSON.parse(todo()) as CardPayload;
    expect(reminderOf(base)).toEqual({ title: 'Pay rent', due: '2026-11-20', due_time: null });
    expect(reminderOf({ ...base, dueTime: '15:00' } as CardPayload)?.due_time).toBe('15:00');
    for (const over of [{ status: 'done' }, { waiting: true }, { archived: true }, { template: true }, { due: null }, { type: 'note' }]) expect(reminderOf({ ...base, ...over } as CardPayload)).toBeNull();
  });

  it('says when it’s due, in the browser’s language', () => {
    expect(notification('c1', { title: 'Pay rent', due: '2026-11-20', due_time: '15:00' }, { locale: 'en-US', time_zone: 'UTC' })).toEqual({ title: 'Pay rent', body: 'Due at 3:00 PM', url: '/journal/c1', tag: 'due:c1' });
    expect(notification('c1', { title: 'Pay rent', due: '2026-11-20', due_time: null }, { locale: 'en-US', time_zone: 'UTC' }).body).toBe('Due today');
  });
});

describe('reminders on the server', () => {
  it('keeps a note of open todos as they’re pushed, and lets them go when done or encrypted', async () => {
    const { db, signIn, push } = setup();
    const ann = await signIn('ann');
    const rows = async () => (await db.prepare(`SELECT card_id, due, due_time FROM reminders`).all<{ card_id: string; due: string; due_time: string | null }>()).results;
    await push(ann.cookie, [rec(ann.vault, 't1', { payload: todo({ dueTime: '15:00' }) }), rec(ann.vault, 'n1')]);
    expect(await rows()).toEqual([{ card_id: 't1', due: '2026-11-20', due_time: '15:00' }]);
    await push(ann.cookie, [rec(ann.vault, 't1', { seq: 1, updated_at: 200, payload: todo({ status: 'done' }) })]);
    expect(await rows()).toEqual([]);
    await push(ann.cookie, [rec(ann.vault, 't2', { payload: 'e1:sealed' })]);
    expect(await rows()).toEqual([]);
  });

  it('takes a browser’s subscription, its settings checked, and lets it go', async () => {
    const { db, signIn, call } = setup();
    const ann = await signIn('ann');
    expect(await (await call('/api/push/key', {}, ann.cookie)).json()).toEqual({ key: null });
    const put = (body: unknown) => call('/api/push/subscription', { method: 'PUT', body: JSON.stringify(body) }, ann.cookie);
    expect((await put({ ...subscription(), endpoint: 'http://insecure.example' })).status).toBe(400);
    expect((await put({ ...subscription(), timeZone: 'Mars/Base', lead: 7 })).status).toBe(200);
    const row = await db.prepare(`SELECT time_zone, remind_at, lead_minutes FROM push_subscriptions`).first();
    expect(row).toEqual({ time_zone: 'UTC', remind_at: '08:30', lead_minutes: 0 });
    await put(subscription());
    expect(await db.prepare(`SELECT time_zone, lead_minutes FROM push_subscriptions`).all()).toEqual({ results: [{ time_zone: 'Asia/Taipei', lead_minutes: 10 }] });
    await call('/api/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription().endpoint }) }, ann.cookie);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).first<{ n: number }>())!.n).toBe(0);
    expect((await call('/api/push/test', { method: 'POST' }, ann.cookie)).status).toBe(503);
  });

  it('sends each due reminder once to the browsers of those who can change it, and forgets a browser that’s gone', async () => {
    const { db, signIn, call, push } = setup();
    const ann = await signIn('ann');
    const ben = await signIn('ben');
    const cat = await signIn('cat');
    await call(`/api/vaults/${ann.vault}/members`, { method: 'POST', body: JSON.stringify({ email: 'ben@example.com', role: 'editor' }) }, ann.cookie);
    await call(`/api/vaults/${ann.vault}/members`, { method: 'POST', body: JSON.stringify({ email: 'cat@example.com', role: 'viewer' }) }, ann.cookie);
    for (const [who, endpoint] of [
      [ann, 'https://push.example.com/ann'],
      [ben, 'https://push.example.com/ben'],
      [cat, 'https://push.example.com/cat'],
    ] as const) {
      await call('/api/push/subscription', { method: 'PUT', body: JSON.stringify({ ...subscription(endpoint), timeZone: 'UTC', lead: 0 }) }, who.cookie);
    }
    await push(ann.cookie, [rec(ann.vault, 't1', { payload: todo({ title: 'Call the bank', dueTime: '15:00' }) }), rec(ann.vault, 't2', { payload: todo({ due: '2026-11-21' }) })]);

    const sent: [string, unknown][] = [];
    let outcome: 'sent' | 'gone' = 'sent';
    const send = async (target: PushTarget, message: unknown) => (sent.push([target.endpoint, message]), outcome);
    const at = (iso: string) => Date.parse(iso);

    expect(await sendReminders(db, send, at('2026-11-20T14:59:00Z'))).toBe(0);
    expect(await sendReminders(db, send, at('2026-11-20T15:02:00Z'))).toBe(2);
    expect(sent.map(([to]) => to).sort()).toEqual(['https://push.example.com/ann', 'https://push.example.com/ben']);
    expect(sent[0][1]).toMatchObject({ title: 'Call the bank', url: '/journal/t1' });
    // Not again; and a reminder hours late isn't sent at all.
    expect(await sendReminders(db, send, at('2026-11-20T15:07:00Z'))).toBe(0);
    expect(await sendReminders(db, send, at('2026-11-21T20:00:00Z'))).toBe(0);
    // A new due date reminds again; a browser gone for good is forgotten.
    await push(ann.cookie, [rec(ann.vault, 't1', { seq: 1, updated_at: 200, payload: todo({ title: 'Call the bank', due: '2026-11-22', dueTime: '09:00' }) })]);
    outcome = 'gone';
    expect(await sendReminders(db, send, at('2026-11-22T09:01:00Z'))).toBe(0);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).first<{ n: number }>())!.n).toBe(1);
  });
});
