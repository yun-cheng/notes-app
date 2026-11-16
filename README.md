# notes-app

One local-first app for notes, todos and a diary, built as an installable PWA. `notes-app` is a working name.

Decisions, the data model and the milestones are in [PLAN.md](PLAN.md).

**Status:** All seven milestones are built: notes work offline (each page's title bar says Synced, Syncing…, Offline or Not synced, with a Sync now button behind it, and an entry not yet on the server shows a clock), sync between devices through a Google account (a browser can stay signed in to several, shown by their Google photo, and switch between them from the account menu), can be kept in private vaults that are end-to-end encrypted, and can be opened to Claude and other AI apps over MCP, vault by vault, can hold photos, stored in Google Drive, and can be shared: whole vaults or single cards (a card shared with a vault is in that vault too, and its members get no more than the vault gives them), with comments and public links. Notes and todos share one journal, a stream of compact bubbles like a chat, under day badges that stay pinned at the top while their day scrolls past, with a button above the writing box to jump back to the newest entries: `[]` makes a todo (`@fri @3pm @weekly` gives it a due date, a time and a repeat, its due-date menu can give it a start date too, a month calendar shows todos on their days, spans from start to due, dragged to another day to move them, and a timeline shows them as bars to drag or stretch, and a todo waiting on someone or something can be marked Waiting, with a dashed box, so it's left out of what's due and never overdue), `#diary` files an entry in the Diary vault every account starts with (the diary is just that vault: its entries are ordinary notes and todos, and a PIN makes it private) and `#tag` files an entry (tags can be grouped, like a Priority that takes one of High, Medium or Low), a row of chips under the page title filters the journal by type, todo status, date (the past day, week or month, or any day or range of days picked in a calendar that jumps by month and year too and measures a length from a day, like 2 weeks ending Nov 9, which also opens from a day's badge in the journal) and what an entry holds, each chip in use with an × to take it off, and an Archived chip shows the entries put away, while the sidebar narrows it to a tag or a vault; the journal can also show as a board, by todo state (Open, Waiting, Done, where dragging a todo ticks it, reopens it or marks it waiting) or with a tag group's tags as columns, where cards are dragged between columns to change their tag and up or down to set their order, or added straight into a column, and a group's tag named Done ticks the todos dropped in it (and a ticked todo moves there); Cmd+K runs any action or search from the keyboard, and picked entries can be tagged, finished, marked waiting, dated, switched between note and todo, copied, cut, pasted, moved, archived or trashed together, with keyboard shortcuts for each (`?` lists them). Each entry shows its vaults, which move it to another vault or put it in more than one in a click (inside a vault too), a todo's due date and an entry's tags can be changed right from the journal, and a right-click on an entry (or the ⋯ beside it) opens a menu to edit it, copy it, pick it, tick it, make it a todo or a note, color it, share it, set it to view only, archive it or trash it, or, among several picked entries, copy, cut, archive or trash them all; an archived entry, done or not, leaves the journal and the todo counts but stays in search, links and its history until it's unarchived; a copy button on each entry copies it in one click. Copied text goes out as rich text (formatting for Mail, Notes or Docs, plain words for apps that take only text), Markdown or plain text, and pasted text comes in with its formatting, read as Markdown or as plain text: a setting on each device picks where each copy and paste starts, and its toast offers the other styles for that one; entries pasted back into the journal come back whole whatever the style. An eye in the title bar turns on view only, for reading without changing anything by mistake, and one entry can be set to view only from its menu, for everyone and every device. An entry can hold checklists, ticked in the open entry, and its bubble shows how many of their items are done and how many of its comments are open. Words can be hidden, blurred until pressed (`||words||`, or Hide in the formatting row), and a card can have a back, like a flashcard, that its bubble flips over to show. Entries can be stacked into one, like a deck, opened in the journal to drag them into an order of their own. Code snippets keep their indent and show in a code font, colored by their language, picked from a list on the block (or typed as ` ```js `) and named in the corner of the bubble, with a button that copies them. Links in entries can be clicked, and how link and photo previews look is a setting, which each entry can override, along with its own color. Each card has a version history with restore, the editor has undo and redo buttons, and Cmd+Z undoes the last change anywhere in the app (a trashed, ticked, moved, tagged or pasted entry), with redo. A History page lists what was changed, newest first: on this device, with undo and redo for each change, and on your other devices, by AI apps and by people you share with, each marked with who or what made it and with an Undo of its own; the sidebar's filters narrow it the way they narrow the journal, and undo there keeps to the changes shown. A native app for Mac, iPhone and iPad is built in SwiftUI; an Android app in Kotlin is next.

**Live:** https://notes-app.yuncheng-dev.workers.dev, a Cloudflare Worker that Cloudflare builds and deploys from GitHub on every push to `main` (Workers Builds), after the tests, typecheck and build pass. Every other branch gets its own preview address.

## Run it

Needs Node 22 or later.

```bash
npm install
npm run db:migrate:local
npm run build
npm run dev:api
```

Then, in a second terminal, start the app with `npm run dev`. The app runs on port 5191, the API on port 8788, and Vite proxies `/api` to it. Rebuild only when you want `dev:api` itself to serve the latest app.

To keep both running after the terminal closes, start them in tmux:

```bash
tmux new-session -d -s notes-app -n api 'npm run dev:api' \; new-window -n web 'npm run dev'
```

`tmux attach -t notes-app` shows their output and `tmux kill-session -t notes-app` stops both.

To try the app without signing in, fill the local server with a demo account and open it:

```bash
npm run demo
```

Then open http://localhost:5191/demo while `npm run dev` is running. It signs this browser in as "Demo", with an example of each feature: folders and colored tags; tag groups (Priority, to sort by or show as a board, and a many-choice Topics); todos for the board by todo state; a week of notes with headings, a stack of flashcards, each with a back to flip to, lists, checklists, quotes, code, web links (one with its own preview style) and links between notes; todos overdue, due today at a time, upcoming, some with start dates, undated, repeating (every 3 days, weekly, monthly), waiting, done and archived, some tinted; a note set to view only, with its password hidden until pressed; a Family vault shared with a second demo user, Sam, with a card that's also in it from Personal, comments open and resolved, and a note Sam shares with you; Sam's Book club vault, shared with you to view; a public link to the curry recipe; AI read access on Personal; a note edited on a second device, so its history has two versions; and a Diary vault that is private and encrypted. Photos aren't in it, since they need Google Drive. The Diary vault's PIN is `1234`. Running `npm run demo` again puts the demo's own notes back as they were, with dates moved to today, and keeps anything added to the demo accounts by hand (vaults, notes, todos). The app marks the demo account with a red Demo tag by every page title, so it isn't taken for your own. `/demo` exists only in the dev server, never in a build.

Sign-in needs a Google OAuth client ID in `GOOGLE_CLIENT_ID` in `wrangler.jsonc`, with `http://localhost:5191` as an authorized origin. Photo upload also needs the client secret in `.dev.vars` as `GOOGLE_CLIENT_SECRET`; see PLAN.md, Milestone 5.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Check types |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the build, with the service worker active |
| `npm run check` | Run the tests, typecheck and build: what Cloudflare runs before each deploy |
| `npm run release` | Apply new database migrations to production, then publish `dist/` as the Worker: what Cloudflare runs to deploy |
| `npm run deploy` | Build, then `release`, by hand (needs `npx wrangler login` first). Pushing to `main` does this on its own |
| `npm run dev:api` | Run the Worker locally: the API, the built app from `dist/`, and a local D1 database |
| `npm run db:migrate:local` | Apply database migrations locally |
| `npm run db:migrate:remote` | Apply database migrations to production |
| `npm run demo` | Fill the local server with a demo account (see above) |
| `npm run icons` | Regenerate the PWA icons from `public/icon.svg` |

The service worker only runs in the built app, so use `build` then `preview` to test offline behaviour. Installing on a phone needs HTTPS.

## Native apps

The Mac, iPhone and iPad app is a native SwiftUI app in `apple/`. It needs macOS 26 or iOS 26, Xcode 26 and XcodeGen (`brew install xcodegen`). Builds sign with the Apple development team set as `DEVELOPMENT_TEAM` in `project.yml`; change it to build under another account. An Android app in Kotlin comes next.

| Command (in `apple/`) | What it does |
| --- | --- |
| `xcodegen` | Generates `Notes.xcodeproj` from `project.yml` (the project file isn't committed) |
| `swift test --package-path NotesKit` | Tests the shared core: storage, sync, encryption, Argon2id and the rich text conversion |
| `xcodebuild -project Notes.xcodeproj -scheme Notes -destination 'platform=macOS' -derivedDataPath build/dd build -allowProvisioningUpdates` | Builds `build/dd/Build/Products/Debug/Notes App.app` |
| `xcodebuild -project Notes.xcodeproj -scheme Notes -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/dd build -allowProvisioningUpdates` | Builds the app for the iOS Simulator |

Launch with `-server http://localhost:8788` to point the app at the local server. The apps sign in by pairing with the web app: the app shows a code, a sign-in sheet opens `/pair`, and once you confirm the code there the app gets its own session as a bearer token.

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
server/     Hono API: Google token check, sessions, vaults, push and pull, card history, OAuth and MCP for AI apps, photos in Drive, sharing and comments. worker.ts runs it as a Cloudflare Worker
apple/      Native app for Mac, iPhone and iPad: Notes/ is the SwiftUI app, NotesKit/ its storage, sync and crypto
migrations/ D1 schema
```

## How it fits together

- **The UI goes through `CardRepository`.** It never touches IndexedDB, so the store can change without touching the UI.
- **Stored records are opaque.** Only `id, vault_id, updated_at, deleted, seq` are plain. Everything else is a string produced by `PayloadCodec`: JSON in open vaults, ciphertext in encrypted private vaults.
- **Writes run one at a time.** The repository queues them so overlapping saves can't overwrite each other.
- **Edits are journaled.** Each edit goes to `localStorage` synchronously, is cleared once committed, and is replayed on next launch, so closing the page mid-save loses nothing.
- **Backlinks and search are derived on each device.** `buildIndex` recomputes them from the cards, and they are never stored or synced.
- **Sync never blocks writing.** Edits save locally first and are pushed in the background. Remote changes share the write queue, and never overwrite unpushed edits. That includes an edit typed while a push that lost a conflict was on its way.
- **Each account has its own local database**, and the server checks vault membership on every request. A card someone moves into a vault you aren't in leaves your devices at the next sync (the server notes each move in `card_moves`).
- **Locked cards stop at `buildIndex`.** Lists, search, backlinks and exports are built from the index, so a new view can't leak a locked card by accident. Links must go through `linkTitle`, because a link stores the title it was created with.
- **History lives on the server.** Each push that changes a card extends or adds a version, so history needs a connection but covers every device. Versions hold the same opaque payload as cards, and say who saved them, from which device or through which AI app, and whether the card was in the Trash. `GET /api/versions` lists the newest versions across cards, each with the one it replaced.
- **Undo is a log on the device.** `CardRepository` logs every change it writes (the card before and after, and the action it was part of) in the local database. Undo and redo write the changed fields back, and only while the card still holds what the change left, so they never overwrite a later edit. The server's history is separate. The History page (`/history`) shows the log and, between its entries, the server's newest versions of every card read as changes (`useSyncedChanges`), without the ones this device made, which the log has. A change that came by sync is undone with `repo.takeBack`, which writes its fields back as a new change in the log. The page takes the journal's filter from the same query string (a change matches if its card passed the filter before or after it), and scopes Cmd+Z to what it shows.
- **AI apps get the same protection as locked vaults.** The MCP server builds its index with every vault closed to AI marked locked, and writes through the same push path as devices, so AI edits sync and show in history.
- **Private vaults are encrypted before anything is stored.** The payload codec is a keyring: a card in an encrypted vault is encrypted as it's written, and a card whose key isn't open decodes to a sealed stand-in that can never be saved.
- **Turning encryption on can be picked up again.** The device notes that a vault is being encrypted before it tells the server. If the tab closes or a sync fails before every card is stored again and the server's readable versions are dropped, the rest is done the next time the vault is opened on that device (`src/state/encrypting.ts`).
- **Dates are local calendar days** stored as `YYYY-MM-DD` keys, never UTC instants.
