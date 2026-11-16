import { createApp } from './app';
import { removeExpired } from './cleanup';
import type { Bindings } from './db';
import { runReminders } from './reminders';

const app = createApp();

/**
 * The server, run as a Cloudflare Worker. Cloudflare serves the built app from `dist` on its own; only `/api/*` and
 * `/.well-known/*` (where OAuth and MCP clients look for discovery documents) reach this code, as
 * `assets.run_worker_first` in wrangler.jsonc says. On the schedules in wrangler.jsonc: once a day expired rows go,
 * and every five minutes due-date reminders are sent.
 */
export default {
  fetch: app.fetch,
  scheduled(event: { cron: string }, env: Bindings, ctx: { waitUntil(work: Promise<unknown>): void }) {
    if (event.cron === DAILY) ctx.waitUntil(removeExpired(env.DB, Date.now()));
    else ctx.waitUntil(runReminders(env, Date.now()));
  },
};

/** The daily schedule in wrangler.jsonc; the other is the reminders'. */
const DAILY = '17 4 * * *';
