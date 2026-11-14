import { createApp } from './app';
import { removeExpired } from './cleanup';
import type { Database } from './db';

const app = createApp();

/**
 * The server, run as a Cloudflare Worker. Cloudflare serves the built app from `dist` on its own; only `/api/*` and
 * `/.well-known/*` (where OAuth and MCP clients look for discovery documents) reach this code, as
 * `assets.run_worker_first` in wrangler.jsonc says. Once a day, on the schedule in wrangler.jsonc, expired rows go.
 */
export default {
  fetch: app.fetch,
  scheduled(_event: unknown, env: { DB: Database }, ctx: { waitUntil(work: Promise<unknown>): void }) {
    ctx.waitUntil(removeExpired(env.DB, Date.now()));
  },
};
