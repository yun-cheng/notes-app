# notes-app

One local-first app for notes, todos and a diary, built as an installable PWA. `notes-app` is a working name.

Decisions, the data model and the milestones are in [PLAN.md](PLAN.md).

**Status:** All seven milestones are built: notes work offline, sync between devices through a Google account, can be kept in private vaults that are end-to-end encrypted, and can be opened to Claude and other AI apps over MCP, vault by vault, can hold photos, stored in Google Drive, and can be shared: whole vaults or single cards, with comments and public links. Each card has a version history with restore, and the editor has undo and redo buttons.

**Live:** https://notes-app-afc.pages.dev, deployed manually with `npm run deploy`.

## Run it

Needs Node 22 or later.

```bash
npm install
npm run db:migrate:local
npm run build
npm run dev:api
```

Then, in a second terminal, start the app with `npm run dev`. The API runs on port 8788 and Vite proxies `/api` to it. Rebuild only when you want `dev:api` itself to serve the latest app.

Sign-in needs a Google OAuth client ID in `GOOGLE_CLIENT_ID` in `wrangler.jsonc`, with `http://localhost:5191` as an authorized origin. Photo upload also needs the client secret in `.dev.vars` as `GOOGLE_CLIENT_SECRET`; see PLAN.md, Milestone 5.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Check types |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the build, with the service worker active |
| `npm run deploy` | Build and publish to Cloudflare Pages (needs `npx wrangler login` first; run `db:migrate:remote` first if the schema changed) |
| `npm run dev:api` | Run the API and a local D1 database |
| `npm run db:migrate:local` | Apply database migrations locally |
| `npm run db:migrate:remote` | Apply database migrations to production |
| `npm run icons` | Regenerate the PWA icons from `public/icon.svg` |

The service worker only runs in the built app, so use `build` then `preview` to test offline behaviour. Installing on a phone needs HTTPS.

## Layout

```
src/
  domain/   Card types and pure logic: links, backlinks, todo views, search, Markdown, backup format
  storage/  CardStore interface, IndexedDB and in-memory stores, CardRepository, write-ahead journal
  state/    React context that loads cards and builds the derived index
  sync/     Sync engine, HTTP transport, and the protocol shared with the server
  photos/   Photo queue: shrink on the device, keep in IndexedDB, upload in the background
  auth/     Google sign-in screen and the account gate
  crypto/   Vault keys (Argon2id, AES-GCM, recovery keys) and the keyring that encrypts private cards
  ui/       App shell, shared components, pages, and the TipTap editor
server/     Hono API: Google token check, sessions, vaults, push and pull, card history, OAuth and MCP for AI apps, photos in Drive, sharing and comments
functions/  Cloudflare Pages entry points: /api and /.well-known
migrations/ D1 schema
```

## How it fits together

- **The UI goes through `CardRepository`.** It never touches IndexedDB, so another `CardStore` can back the same UI in a Tauri build.
- **Stored records are opaque.** Only `id, vault_id, updated_at, deleted, seq` are plain. Everything else is a string produced by `PayloadCodec`: JSON today, ciphertext later.
- **Writes run one at a time.** The repository queues them so overlapping saves can't overwrite each other.
- **Edits are journaled.** Each edit goes to `localStorage` synchronously, is cleared once committed, and is replayed on next launch, so closing the page mid-save loses nothing.
- **Backlinks and search are derived on each device.** `buildIndex` recomputes them from the cards, and they are never stored or synced.
- **Sync never blocks writing.** Edits save locally first and are pushed in the background. Remote changes share the write queue, and never overwrite unpushed edits.
- **Each account has its own local database**, and the server checks vault membership on every request.
- **Locked cards stop at `buildIndex`.** Lists, search, backlinks and exports are built from the index, so a new view can't leak a locked card by accident. Links must go through `linkTitle`, because a link stores the title it was created with.
- **History lives on the server.** Each push that changes a card extends or adds a version, so history needs a connection but covers every device. Versions hold the same opaque payload as cards.
- **AI apps get the same protection as locked vaults.** The MCP server builds its index with every vault closed to AI marked locked, and writes through the same push path as devices, so AI edits sync and show in history.
- **Private vaults are encrypted before anything is stored.** The payload codec is a keyring: a card in an encrypted vault is encrypted as it's written, and a card whose key isn't open decodes to a sealed stand-in that can never be saved.
- **Dates are local calendar days** stored as `YYYY-MM-DD` keys, never UTC instants.
