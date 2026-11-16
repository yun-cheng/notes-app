import { useEffect, useState } from 'react';
import { pushKey, removePushSubscription, savePushSubscription, sendTestPush, type PushSettings } from '../sync/http';
import { Section } from './components';
import { useToast } from './Toast';

const SETTINGS_KEY = 'notes-app:reminders';
const DEFAULTS: PushSettings = { lead: 0, remindAt: '09:00' };
const LEADS: [number, string][] = [
  [0, 'At the due time'],
  [5, '5 minutes before'],
  [10, '10 minutes before'],
  [15, '15 minutes before'],
  [30, '30 minutes before'],
  [60, '1 hour before'],
  [120, '2 hours before'],
];

function readSettings(): PushSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<PushSettings> | null;
    return { ...DEFAULTS, ...(saved ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

function keepSettings(settings: PushSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Kept on the server for this browser anyway.
  }
}

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

/** Why this browser can't have reminders, or null when it can. */
type Blocked = 'unsupported' | 'no-worker' | 'not-set-up' | 'denied' | 'offline' | null;

const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Due-date reminders on this browser: notifications pushed by the server when an open todo comes due, even with
 * the app closed. Turning them on asks the browser's permission and leaves a subscription on the server, with this
 * browser's time zone, how long before a todo's time to remind, and when a todo with only a date reminds.
 */
export function RemindersSection() {
  const toast = useToast();
  const [blocked, setBlocked] = useState<Blocked | 'checking'>('checking');
  const [key, setKey] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [settings, setSettings] = useState(readSettings);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return live && setBlocked('unsupported');
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return live && setBlocked('no-worker');
      let serverKey: string | null;
      try {
        serverKey = await pushKey();
      } catch {
        return live && setBlocked('offline');
      }
      if (!live) return;
      if (!serverKey) return setBlocked('not-set-up');
      setKey(serverKey);
      setSubscription(await registration.pushManager.getSubscription());
      setBlocked(Notification.permission === 'denied' ? 'denied' : null);
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = async (sub: PushSubscription, next: PushSettings) => {
    await savePushSubscription(sub.toJSON(), next);
  };

  const turnOn = async () => {
    if (!key) return;
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setBlocked('denied');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      // A subscription made with another server key can't be used: start again.
      const sameKey = existing?.options.applicationServerKey && new Uint8Array(existing.options.applicationServerKey).join() === fromBase64Url(key).join();
      if (existing && !sameKey) await existing.unsubscribe();
      const sub = existing && sameKey ? existing : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) });
      await save(sub, settings);
      setSubscription(sub);
      toast('Reminders are on in this browser');
    } catch {
      toast("Reminders couldn't be turned on. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!subscription) return;
    setBusy(true);
    try {
      await removePushSubscription(subscription.endpoint).catch(() => undefined);
      await subscription.unsubscribe();
      setSubscription(null);
      toast('Reminders are off in this browser');
    } finally {
      setBusy(false);
    }
  };

  const change = (patch: Partial<PushSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    keepSettings(next);
    if (subscription) void save(subscription, next).catch(() => toast("That didn't reach the server. Try again with a connection."));
  };

  const test = async () => {
    try {
      const { sent } = await sendTestPush();
      toast(sent ? `Sent a test reminder${sent > 1 ? ` to ${sent} browsers` : ''}` : 'No browser took the test reminder. Turn reminders off and on again.');
    } catch {
      toast("The test couldn't be sent.");
    }
  };

  const note: Record<Exclude<Blocked, null>, string> = {
    unsupported: isApple ? 'On iPhone and iPad, reminders need the app added to the Home Screen (Share, then Add to Home Screen), opened from there.' : "This browser can't show reminders.",
    'no-worker': 'Reminders work in the installed app, or a built copy of it, where the app can run in the background. This page has no service worker.',
    'not-set-up': "Reminders aren't set up on this server yet: it needs its VAPID keys (see the README).",
    denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then come back.",
    offline: 'Reminders can be changed with a connection.',
  };

  return (
    <Section title="Reminders">
      <p className="prose-note">
        A notification when an open todo comes due, even with the app closed: at its time, or for a todo with only a date, at the time set below. Waiting todos don't remind,
        and nor do todos in an encrypted vault, which the server can't read. This is set for each browser.
      </p>
      {blocked === 'checking' ? null : blocked ? (
        <p className="prose-note reminders__note">{note[blocked]}</p>
      ) : (
        <>
          <div className="field-row">
            <span className="field-row__label">This browser</span>
            {subscription ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void turnOff()}>
                Turn off
              </button>
            ) : (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void turnOn()}>
                Turn on reminders
              </button>
            )}
            {subscription && (
              <button type="button" className="btn btn--quiet" onClick={() => void test()}>
                Send a test
              </button>
            )}
          </div>
          <label className="field-row">
            <span className="field-row__label">Todos with a time</span>
            <select value={settings.lead} onChange={(e) => change({ lead: Number(e.target.value) })}>
              {LEADS.map(([minutes, label]) => (
                <option key={minutes} value={minutes}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span className="field-row__label">Todos with only a date</span>
            <input type="time" value={settings.remindAt} onChange={(e) => e.target.value && change({ remindAt: e.target.value })} />
          </label>
        </>
      )}
    </Section>
  );
}
