import { isDateKey, isTimeKey } from './dates';
import type { CardPayload } from './types';

/**
 * Due-date reminders: which todos remind, when, and what the notification says. The server works these out for the
 * todos it can read (server/reminders.ts); a device does for those in an encrypted vault (src/reminders/sealed.ts).
 */

const MINUTE = 60_000;
/** A reminder this late isn't sent: the browser was away, or reminders were turned on after it was due. */
export const LATE = 6 * 60 * MINUTE;

/** A browser's reminder settings: its time zone and language, when a date alone reminds, and how long before a time. */
export interface ReminderSettings {
  time_zone: string;
  locale: string;
  remind_at: string;
  lead_minutes: number;
}

export interface Reminder {
  title: string;
  due: string;
  due_time: string | null;
}

/** What a card reminds of: an open todo with a due date, not waiting, archived or a template. */
export function reminderOf(card: CardPayload): Reminder | null {
  if (card.type !== 'todo' || card.status !== 'open' || card.waiting || card.archived || card.template || !isDateKey(card.due)) return null;
  return { title: card.title.trim() || 'Todo', due: card.due, due_time: isTimeKey(card.dueTime) ? card.dueTime : null };
}

/** How far a time zone's clock is ahead of UTC at an instant, in ms. */
function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(at / 1000) * 1000;
}

/** The instant a local date and time is in a time zone. */
export function localInstant(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - zoneOffset(wall, timeZone);
  // Across a clock change the offset at the answer can differ from the guess's.
  return wall - zoneOffset(first, timeZone);
}

/** When a reminder goes off for one browser: at its due time less the lead, or for a date alone, at `remind_at`. */
export function fireAt(reminder: Reminder, sub: Pick<ReminderSettings, 'time_zone' | 'remind_at' | 'lead_minutes'>): number {
  if (reminder.due_time) return localInstant(reminder.due, reminder.due_time, sub.time_zone) - sub.lead_minutes * MINUTE;
  return localInstant(reminder.due, sub.remind_at, sub.time_zone);
}

export const dueKey = (r: Reminder) => `${r.due} ${r.due_time ?? ''}`;

/** The notification for a reminder: the todo's name, when it's due, and where it opens. */
export function notification(cardId: string, reminder: Reminder, sub: Pick<ReminderSettings, 'locale' | 'time_zone'>) {
  let body = 'Due today';
  if (reminder.due_time) {
    let time = reminder.due_time;
    try {
      const [h, m] = reminder.due_time.split(':').map(Number);
      time = new Intl.DateTimeFormat(sub.locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h, m));
    } catch {
      // The time as written.
    }
    body = `Due at ${time}`;
  }
  return { title: reminder.title, body, url: `/journal/${cardId}`, tag: `due:${cardId}` };
}
