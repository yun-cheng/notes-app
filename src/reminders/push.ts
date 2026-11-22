import { removePushSubscription } from '../sync/http';

/**
 * Stops this browser getting the signed-in account's reminders, as it signs out: the server forgets this browser for
 * that account (and the sealed reminders it kept for it). The browser's own subscription stays, for any other account
 * signed in here.
 */
export async function leavePushHere(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await removePushSubscription(subscription.endpoint);
}
