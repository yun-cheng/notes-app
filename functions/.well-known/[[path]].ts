import { handle } from 'hono/cloudflare-pages';
import { createApp } from '../../server/app';

// OAuth and MCP clients look for discovery documents here, at the site root.
export const onRequest = handle(createApp());
