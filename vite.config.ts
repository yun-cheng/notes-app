import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Only in `npm run dev`, never in a build: /demo signs this browser in to the demo account that
 * `npm run demo` made on the local server, alongside any accounts it is already signed in to (/demo/sam to Sam's, the
 * other side of what it shares), and the demo's photos and files are served from scripts/demoPhotos and
 * scripts/demoFiles.
 */
const DEMO_FILE_TYPES: Record<string, string> = { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', mp4: 'video/mp4', m4a: 'audio/mp4', jpg: 'image/jpeg' };

function demoSignIn(): Plugin {
  return {
    name: 'demo-sign-in',
    apply: 'serve',
    configureServer(server) {
      type Session = { token: string; user: { id: string } };
      const session = (who?: string) => {
        const file = '.wrangler/demo-session.json';
        const kept = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Session & { sam?: Session }) : null;
        return who === 'sam' ? (kept?.sam ?? null) : kept;
      };
      const who = (url: string | undefined) => (/(?:^\/sam\b|[?&]as=sam\b)/.test(url ?? '') ? 'sam' : undefined);
      // Adds the demo account to the accounts this browser is signed in to, the way the API adds a sign-in, keeping
      // the others. Under /api, since the session cookie is only sent there.
      server.middlewares.use('/api/demo-session', (req, res) => {
        const demo = session(who(req.url));
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
      // The demo's photos (`demo-photo-<name>` in its entries, or `demo-photo-<name>--<n>` for one of the copies its
      // years of history hold) come from scripts/demoPhotos rather than a Google Drive, for the app and for a public link
      // alike; every other photo goes on to the API.
      server.middlewares.use((req, res, next) => {
        const name = /^\/api\/(?:attachments|public\/[^/]+\/photos)\/demo-photo-([a-z-]+?)(?:--\d+)?$/.exec(req.url?.split('?')[0] ?? '')?.[1];
        const file = name && `scripts/demoPhotos/${name}.jpg`;
        if (req.method !== 'GET' || !file || !existsSync(file)) return next();
        res.setHeader('content-type', 'image/jpeg');
        res.setHeader('cache-control', 'private, max-age=31536000, immutable');
        res.end(readFileSync(file));
      });
      // The demo's files (`demo-file-<name>`, or a copy's `demo-file-<name>--<n>`) likewise, from scripts/demoFiles, sent the way the API sends a file: a
      // video a range at a time when its player asks, and a video's still (`demo-file-<name>-poster`) as a photo.
      server.middlewares.use((req, res, next) => {
        const name = /^\/api\/(?:attachments|public\/[^/]+\/(?:files|photos))\/demo-file-([a-z-]+?)(?:--\d+)?$/.exec(req.url?.split('?')[0] ?? '')?.[1];
        const file = name && readdirSync('scripts/demoFiles').find((f) => f.startsWith(`${name}.`) && !f.endsWith('.mjs') && !f.endsWith('.json'));
        if (req.method !== 'GET' || !file) return next();
        const type = DEMO_FILE_TYPES[file.split('.').pop()!] ?? 'application/octet-stream';
        res.setHeader('content-type', type);
        if (!type.startsWith('image/')) {
          res.setHeader('content-disposition', 'attachment');
          res.setHeader('content-security-policy', 'sandbox');
        }
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('accept-ranges', 'bytes');
        const bytes = readFileSync(`scripts/demoFiles/${file}`);
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (!range || (!range[1] && !range[2])) return res.end(bytes);
        const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        res.statusCode = 206;
        res.setHeader('content-range', `bytes ${start}-${end}/${bytes.length}`);
        res.end(bytes.subarray(start, end + 1));
      });
      // The Diary's sealed photo and voice message (`demo-sealed-<name>`), sealed by `npm run demo` into
      // .wrangler/demo-sealed, sent as the API sends a sealed one: bytes that say nothing, a range at a time if asked.
      server.middlewares.use((req, res, next) => {
        const id = /^\/api\/attachments\/(demo-sealed-[a-z-]+)$/.exec(req.url?.split('?')[0] ?? '')?.[1];
        const file = id && `.wrangler/demo-sealed/${id}`;
        if (req.method !== 'GET' || !file || !existsSync(file)) return next();
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('content-disposition', 'attachment');
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('accept-ranges', 'bytes');
        const bytes = readFileSync(file);
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        if (!range) return res.end(bytes);
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        res.statusCode = 206;
        res.setHeader('content-range', `bytes ${start}-${end}/${bytes.length}`);
        res.end(bytes.subarray(start, end + 1));
      });
      server.middlewares.use('/demo', (req, res) => {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        const as = who(req.url);
        const demo = session(as);
        if (!demo) {
          res.end('<p>Run <code>npm run demo</code> first, with <code>npm run dev:api</code> running.</p>');
          return;
        }
        res.end(`<!doctype html><meta charset="utf-8"><title>Demo</title><p>Signing in to the demo…</p><script>
(async () => {
  await fetch('/api/demo-session${as ? `?as=${as}` : ''}', { method: 'POST' });
  localStorage.setItem('notes-app:account', JSON.stringify(${JSON.stringify(demo.user)}));
  location.replace('/journal');
})();
</script>`);
      });
    },
  };
}

/**
 * Only in `npm run dev`: the tab says "Notes Dev" with the icon on amber, as the native dev builds do, so the dev
 * server is told apart from the deployed app at a glance. Builds keep "Notes" and the green icon.
 */
function devLook(): Plugin {
  return {
    name: 'dev-look',
    apply: 'serve',
    transformIndexHtml(html) {
      const icons = /\s*<link rel="icon"[^>]*>|\s*<link rel="apple-touch-icon"[^>]*>/g;
      const changed = html
        .replace('<title>Notes</title>', '<title>Notes Dev</title>')
        .replace(icons, '')
        .replace('</title>', '</title>\n    <link rel="icon" href="/src/assets/icon-dev.svg" type="image/svg+xml" />');
      if (changed === html || !changed.includes('Notes Dev')) throw new Error('dev-look: index.html no longer has <title>Notes</title>');
      return changed;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    demoSignIn(),
    devLook(),
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
