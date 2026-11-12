import { createApp } from './app';

/**
 * The server, run as a Cloudflare Worker. Cloudflare serves the built app from `dist` on its own; only `/api/*` and
 * `/.well-known/*` (where OAuth and MCP clients look for discovery documents) reach this code, as
 * `assets.run_worker_first` in wrangler.jsonc says.
 */
export default createApp();
