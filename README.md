# notes-app

One local-first app for notes, todos and a diary, built as an installable PWA. `notes-app` is a working name.

Decisions, the data model and the milestones are in [PLAN.md](PLAN.md).

**Status:** Milestone 1 is built: everything works on one device. There is no sync or account yet, so notes stay in the browser they were written in. Use **Backup & settings** to download a backup.

**Live:** https://notes-app-afc.pages.dev, deployed manually with `npm run deploy`.

## Run it

Needs Node 22 or later.

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Check types |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the build, with the service worker active |
| `npm run deploy` | Build and publish to Cloudflare Pages (needs `npx wrangler login` first) |
| `npm run icons` | Regenerate the PWA icons from `public/icon.svg` |

The service worker only runs in the built app, so use `build` then `preview` to test offline behaviour. Installing on a phone needs HTTPS.

## Layout

```
src/
  domain/   Card types and pure logic: links, backlinks, todo views, search, Markdown, backup format
  storage/  CardStore interface, IndexedDB and in-memory stores, CardRepository, write-ahead journal
  state/    React context that loads cards and builds the derived index
  ui/       App shell, shared components, pages, and the TipTap editor
```

## How it fits together

- **The UI goes through `CardRepository`.** It never touches IndexedDB, so another `CardStore` can back the same UI in a Tauri build.
- **Stored records are opaque.** Only `id, vault_id, updated_at, deleted, seq` are plain. Everything else is a string produced by `PayloadCodec`: JSON today, ciphertext later.
- **Writes run one at a time.** The repository queues them so overlapping saves can't overwrite each other.
- **Edits are journaled.** Each edit goes to `localStorage` synchronously, is cleared once committed, and is replayed on next launch, so closing the page mid-save loses nothing.
- **Backlinks and search are derived on each device.** `buildIndex` recomputes them from the cards, and they are never stored or synced.
- **Dates are local calendar days** stored as `YYYY-MM-DD` keys, never UTC instants.
