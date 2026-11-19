import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Only in `npm run dev`, never in a build: /demo signs this browser in to the demo account that
 * `npm run demo` made on the local server, alongside any accounts it is already signed in to, and the demo's
 * photos and files are served from scripts/demoPhotos and scripts/demoFiles.
 */
const DEMO_FILE_TYPES: Record<string, string> = { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain' };

function demoSignIn(): Plugin {
  return {
    name: 'demo-sign-in',
    apply: 'serve',
    configureServer(server) {
      const session = () => {
        const file = '.wrangler/demo-session.json';
        return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { token: string; user: { id: string } }) : null;
      };
      // Adds the demo account to the accounts this browser is signed in to, the way the API adds a sign-in, keeping
      // the others. Under /api, since the session cookie is only sent there.
      server.middlewares.use('/api/demo-session', (req, res) => {
        const demo = session();
        if (!demo || req.method !== 'POST') {
          res.statusCode = 404;
          res.end();
          return;
        }
        const current = /(?:^|;\s*)session=([^;]*)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
        const tokens = [demo.token, ...current.split('.').filter((t) => t && t !== demo.token)].slice(0, 5);
        res.setHeader('set-cookie', `session=${tokens.join('.')}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${30 * 86_400}`);
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      });
      // The demo's photos (`demo-photo-<name>` in its entries) come from scripts/demoPhotos rather than a Google Drive,
      // for the app and for a public link alike; every other photo goes on to the API.
      server.middlewares.use((req, res, next) => {
        const name = /^\/api\/(?:attachments|public\/[^/]+\/photos)\/demo-photo-([a-z-]+)$/.exec(req.url?.split('?')[0] ?? '')?.[1];
        const file = name && `scripts/demoPhotos/${name}.jpg`;
        if (req.method !== 'GET' || !file || !existsSync(file)) return next();
        res.setHeader('content-type', 'image/jpeg');
        res.setHeader('cache-control', 'private, max-age=31536000, immutable');
        res.end(readFileSync(file));
      });
      // The demo's files (`demo-file-<name>`) likewise, from scripts/demoFiles, sent the way the API sends a file.
      server.middlewares.use((req, res, next) => {
        const name = /^\/api\/(?:attachments|public\/[^/]+\/files)\/demo-file-([a-z-]+)$/.exec(req.url?.split('?')[0] ?? '')?.[1];
        const file = name && readdirSync('scripts/demoFiles').find((f) => f.startsWith(`${name}.`) && !f.endsWith('.mjs'));
        if (req.method !== 'GET' || !file) return next();
        res.setHeader('content-type', DEMO_FILE_TYPES[file.split('.').pop()!] ?? 'application/octet-stream');
        res.setHeader('content-disposition', 'attachment');
        res.setHeader('content-security-policy', 'sandbox');
        res.setHeader('x-content-type-options', 'nosniff');
        res.end(readFileSync(`scripts/demoFiles/${file}`));
      });
      server.middlewares.use('/demo', (_req, res) => {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        const demo = session();
        if (!demo) {
          res.end('<p>Run <code>npm run demo</code> first, with <code>npm run dev:api</code> running.</p>');
          return;
        }
        res.end(`<!doctype html><meta charset="utf-8"><title>Demo</title><p>Signing in to the demo…</p><script>
(async () => {
  await fetch('/api/demo-session', { method: 'POST' });
  localStorage.setItem('notes-app:account', JSON.stringify(${JSON.stringify(demo.user)}));
  location.replace('/journal');
})();
</script>`);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    demoSignIn(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png', 'favicon.ico'],
      manifest: {
        id: '/',
        name: 'Notes',
        short_name: 'Notes',
        description: 'Notes, todos and diary in one local-first app.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f2ea',
        theme_color: '#f5f2ea',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        // The privacy page is a plain page of its own (public/privacy.html), not one of the app's.
        navigateFallbackDenylist: [/^\/api\//, /^\/privacy/],
        // Shows due-date reminders pushed by the server (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  // Google sign-in allows this origin, so the port is fixed.
  server: { port: 5191, strictPort: true, proxy: { '/api': 'http://localhost:8788' } },
  preview: { proxy: { '/api': 'http://localhost:8788' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    // Cloudflare's build machines are slower than a laptop, and the first date formatting there can take seconds.
    testTimeout: 30_000,
  },
});
