import { existsSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Only in `npm run dev`, never in a build: /demo signs this browser in as the demo account that
 * `npm run demo` made on the local server, and starts its local copy over.
 */
function demoSignIn(): Plugin {
  return {
    name: 'demo-sign-in',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/demo', (_req, res) => {
        const file = '.wrangler/demo-session.json';
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (!existsSync(file)) {
          res.end('<p>Run <code>npm run demo</code> first, with <code>npm run dev:api</code> running.</p>');
          return;
        }
        const { token, user } = JSON.parse(readFileSync(file, 'utf8')) as { token: string; user: { id: string } };
        // Set the way the API sets it, so it replaces whichever session this browser had.
        res.setHeader('set-cookie', `session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${30 * 86_400}`);
        res.end(`<!doctype html><meta charset="utf-8"><title>Demo</title><p>Signing in to the demo…</p><script>
(async () => {
  const user = ${JSON.stringify(user)};
  localStorage.removeItem('notes-app:journal:' + user.id);
  await new Promise((done) => {
    const r = indexedDB.deleteDatabase('notes-app:user:' + user.id);
    r.onsuccess = r.onerror = r.onblocked = done;
  });
  localStorage.setItem('notes-app:account', JSON.stringify(user));
  location.replace('/notes');
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
        background_color: '#f7f4ee',
        theme_color: '#f7f4ee',
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
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8788' } },
  preview: { proxy: { '/api': 'http://localhost:8788' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
