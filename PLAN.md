# Notes app: plan so far

`notes-app` is a working name. A real name will be picked before the app is shared with anyone.

## Goal

One local-first tool for all personal notes, todos and diary, used on an Android phone and a Mac mini. It may later be shared with other people (family, high school classmates, etc.).

Privacy goal: keep notes private from friends and family. Not defending against forensic or state-level attackers.

Existing apps were considered (Notesnook is the closest, then Anytype, then Obsidian with Meld Encrypt). The owner chose to build their own, as one tool for every need.

## Product decisions

### Cards
Everything is a card: `note`, `todo`, `diary`, `tag`.

- Todo adds status and due date. Today and Upcoming are filters on the journal.
- Diary adds a date, one entry per day. Main view: Calendar / daily page. Defaults to a private vault.
- Links and backlinks are in scope. Canvas/whiteboard is NOT needed for now.

### One journal for everything
Decided 2026-11-12, like Logseq's journal. There is one place where everything is written and read: the Journal, a stream of compact bubbles holding notes, todos and diary entries together, oldest at the top and newest at the bottom like a chat, with a box at the bottom to write the next one. Kinds and places come from markers in the text, not from separate screens, and the box formats them as they're typed:

- `[] ` or `TODO ` at the start turns the line into a checkbox (`#todo` makes a todo too); on a todo, `@today`, `@tomorrow`, `@fri` or `@2026-12-01` sets the due date.
- Each line starting with `[] ` or `TODO ` starts its own entry, so a list of `[] …` lines makes a todo for each. With the box's todo button on, every line is a todo. A last line of only `#tags` applies to all of them.
- `#diary` adds the text to the day's diary entry, in the private vault.
- Any other `#tag` files it under that tag, making the tag if it's new.
- `#` suggests tags, `@` suggests due dates, and `/` lists what can be added: a todo, tag, due date, the diary, a photo, a list, a quote or a heading.

The sidebar is the journal's filter: by type (notes, todos, diary), by todo status (open, due today, upcoming, no date, done), by when it was written (today, the past 7 or 30 days, or a day picked in the Calendar), by tag, by vault, and by whether it holds links or photos, and it sorts by oldest first, newest first, recently edited or due date. Filters combine. Picking a locked vault asks for its PIN right there. New entries go into whatever the journal is narrowed to. On a phone, the same filters open from a button at the top of the journal.

In a note, `/` adds a heading, list, quote, code, divider, photo or link to another note.

Cmd+K (Ctrl+K elsewhere), or `/` anywhere outside a text box, opens a command box for doing anything from the keyboard: every filter, sort and page, new notes, locking vaults, finding notes by their text, and saving what's typed straight to the journal with the same markers. Starting with `/` lists only commands.

Outside text boxes, the journal takes keys for entries: Cmd+A selects all shown, Cmd+C copies the selected entries (or the one focused from the keyboard), Cmd+X cuts them, Delete moves them to the Trash, and Cmd+Z takes the toast's Undo. Up and down arrows move between entries, picking with Shift. Cmd+V pastes copied entries as new ones, written now, into whatever the journal is narrowed to; anything else pasted goes into the writing box. Copying puts readable text on the clipboard (todos as `[ ] Title @date #tag`) plus an exact copy in the app's own type, so formatting, photos, tags and due dates survive. `?` lists every shortcut. A bubble focused by a click never counts as focused for Delete, so a stray key can't trash it.

Several entries can be changed at once. A circle beside each entry (shown on hover) picks it, and so do a click on the row beside the bubble, Cmd-click (Ctrl-click) and a long press; Shift-click picks a range, dragging a box over entries from any empty space around them, in the margins too, picks every one it touches, and Select at the top starts picking. Escape, Done or a click outside the entries stops it. While entries are picked, the writing box becomes a bar that tags or untags them, marks todos done or not, sets their due date, moves them to another vault or trashes them, each with an undo.

An entry's photos show as thumbnails under its bubble, opening full size in a viewer that steps through them, and its web links show as cards with the page's own title, description and image.

Bubbles show their whole text; a long one can be folded to its first six lines, and unfolded, with Less and More in its bottom row. A bubble's text can be selected and copied straight from the stream. The open button beside it on hover, or Enter on a focused bubble, opens it in a small sheet with just its text (on a phone, a tap opens it); formatting, tags, a title, sharing, history and trash sit behind small buttons there. A note without a title is named by its first line.

### Labels are notes
A label is a card of type `tag`, with its own description and links. Tagging a note is a typed link to the tag card, so the tag card's backlinks list every tagged note.

### No folders
There is no separate folder or collection concept. A folder is a tag card pinned in the sidebar. A note can carry many tags, so it can sit in several "folders" at once.

### Vaults
A vault answers "who can see this". Topics belong in tags, not vaults.

- Each card has exactly one home vault.
- A vault named after a group (e.g. "High school") only makes sense if those people are members, or it needs its own PIN.
- Set per vault: lock (none or PIN), AI access (off, read, read + write), members.
- When locked: left out of UI, search, backlinks and the journal (a locked diary day shows only as a "locked" placeholder). Links to its notes show as "Locked". A vault can be fully hidden until unlocked.
- Auto-lock on timeout or when the app goes to the background.
- Search covers only unlocked vaults.

### Unlock
Each private vault has its own PIN or password, separate from the phone's screen lock.

Fingerprint unlock is opt-in and off by default, with a warning: the device accepts any enrolled fingerprint, and family members often have theirs enrolled.

### Sharing a single note
A card has a home vault plus extra share grants.

Flow: pressing Share on a note in Family and picking High school warns "This note is in Family (4 people). Share with High school (23 people)?", then asks for View / Comment / Edit, or Anyone with the link. "Anyone with the link" is what the owner means by "global": an unlisted URL, read-only, with optional expiry and revocable. It is not listed or indexed anywhere.

Rules:
- Sharing a note does not share the notes it links to. Those show as "Not shared".
- A recipient only sees backlinks from notes they can access.
- Sharing from a private vault requires the vault PIN and an extra confirmation.

### MCP server (so Claude and other AI subscriptions can access data)
Runs beside the sync server on the same database, using Cloudflare's MCP setup for Workers and its OAuth library.

- Per-vault AI access: off (default), read, read + write. Private vaults can never have AI access.
- The server enforces this, not the AI.
- Write access is approved by the owner, once per vault (decided 2026-11-10): the AI access setting is the approval, with no per-change prompts. Every AI edit can be undone from history.
- Tools, read: `search_cards`, `get_card` (with backlinks), `list_todos(due, status)`, `get_diary(date range)`.
- Tools, write: `create_note`, `add_todo`, `complete_todo`, `append_to_diary`, plus editing existing notes.
- Every AI edit creates a version labeled as AI-authored, undoable in one click.
- Notes shared with you by others are read-only to the AI, because they could contain text written to manipulate it.

### Encryption: later, but design for it now
- The server only stores opaque records. Plain fields: `id, vault_id, updated_at, deleted, seq`. Everything else goes in one `payload` field: JSON now, ciphertext later, with no server change.
- Search index and backlinks are derived on each device and never synced. (Exception: open vaults with AI access can be searched server-side, e.g. D1 FTS5, for MCP.)
- Later crypto: password through Argon2id to a key-encryption key, which wraps a random AES-GCM key per vault. Each card gets its own key wrapped by the vault key, so sharing one note means sharing only that note's key. Public links keep the key in the URL `#` fragment. Print a one-time recovery key.
- Open vaults: server-side encryption at rest. Private vaults: end-to-end.

Private vaults are end-to-end encrypted since Milestone 7. Open vaults are still readable by someone tech-savvy with the unlocked laptop, which is accepted for this threat model.

## Technical decisions

- **Client:** PWA first. React, TypeScript, Vite, vite-plugin-pwa, React Router, Dexie (IndexedDB), TipTap editor with `[[link]]` autocomplete, MiniSearch, fflate for zip export.
- Keep storage and crypto behind small interfaces. (Meant at first for wrapping the web UI in Tauri 2; the native apps reimplement both instead, see the native apps notes.)
- Call `navigator.storage.persist()`. Build export/backup early, including Markdown plus image files.
- **Note format:** TipTap JSON stored in the card, plus Markdown export. Links by card ID survive renames, and it supports comments and live co-editing through Yjs.
- **Sync server:** hosted, not on the Mac mini. Hono with D1, running as a Pages Function (a Worker on the site's own address, so sessions can use a secure cookie). `POST /api/sync/push` assigns an increasing `seq`; `GET /api/sync/pull?since=<seq>`. Conflict: newest version per card wins, the loser is kept as a conflict copy. Avoid sync engines that need to read the data (PowerSync, Dexie Cloud); avoid Supabase free tier, which pauses when inactive.
- **Auth:** Google sign-in. Single user at first, but multi-user in the data model from day one; every request checks vault membership.
- **Photos:** stored in Google Drive, behind a storage interface, with cards referencing their own attachment ID. Offline photos queue on the device and upload later, with small previews cached locally.
  - Uses the `drive.file` scope; the Worker does the one-time OAuth login and holds the refresh token, handing the app short-lived tokens so the phone isn't re-prompted hourly.
  - Known consequences, to handle at Milestones 5 and 6:
    - Photos from private vaults sit in the owner's Drive, where anyone who can open their Drive app could see them until encryption ships.
    - Shared vaults need a way for members to read the owner's photos (Drive permissions per person, or the Worker serving them with the owner's token).
  - Cloudflare R2 was considered (10 GB free, no download fees, simpler for shared vaults). The storage interface keeps it possible as a later backend.

## Data model

```
User         id, google_sub, email, name
Session      token_hash, user_id, expires_at
Vault        id, owner_id, name, lock(none|pin), ai_access(off|read|write), pin_salt, pin_hash, pin_iterations, hidden
VaultMember  vault_id, user_id, role(owner|editor|viewer)
Card         id, home_vault_id, type(note|todo|diary|tag), payload(TipTap JSON + fields)
Share        card_id, target(vault|user|public_link), role(view|comment|edit), expires_at
Comment      id, card_id, author_id, anchor, body
CardVersion  id, card_id, author_id, started_at, saved_at, payload
```

Links and tag associations live inside the card payload.

## Milestones

1. Works on one device: notes, todos, diary; tags, links and backlinks; search; Today and Calendar views (now journal filters); installable PWA. **Built and deployed; not yet tried on a real Android phone.**
2. Sync and accounts: Worker and D1, Google sign-in, multi-user data model (only the owner using it). **Built and deployed; real Google sign-in works.**
3. Private vaults: PIN, optional fingerprint, auto-lock, hidden from search. **Built and deployed.**
   - Added alongside: version history per card, and undo and redo buttons in the editor. Deployed.
4. MCP server. **Built and tested locally against a simulated AI app; not yet tried from Claude itself.**
5. Photos. **Built and tested locally against a simulated Google; Drive is not connected in production yet (see the setup steps below).**
6. Sharing vaults and single notes (roles, comments, public links). **Built and tested locally with two accounts.**
7. End-to-end encryption for private vaults. **Built and tested locally, including encrypting an existing private vault and recovering a forgotten PIN.**

Later: push reminders for todos.

Native apps: fully native, decided 2026-11-11 after a first try with a Tauri shell around the live site was dropped.
- Mac, iPhone and iPad: one SwiftUI app (iOS 26 and macOS 26). **Built; tested against the local server in the Simulator and on the Mac. Not yet tried on a real iPhone, or signing in with Google on the live site.** It has sign-in, sync, Today, Notes, Todos, Diary, Tags, Trash, the rich text editor and private vaults. Still to come: tags editing, search across everything, history, sharing, comments, photos, AI settings, and encrypting or creating vaults.
- Android: a Kotlin and Jetpack Compose app, next.
- Windows and Linux keep using the web app.

## Resolved questions

1. Folders: dropped as a separate concept. A folder is a tag card pinned in the sidebar.
2. Photos: Google Drive. Consequences are listed under Technical decisions.
3. Name: `notes-app` stays the working name. Pick a real name before sharing it with anyone. The folder stays `~/Projects/notes-app` even after that.
4. Note format: TipTap JSON plus Markdown export, confirmed.
5. "Global" sharing: an unlisted "Anyone with the link" URL, confirmed.

## Open questions

None. Defaults chosen while building are listed in the implementation notes, and can change later.

## Implementation notes from Milestone 1

- Unsaved edits go to a synchronous `localStorage` journal first and are replayed on next launch, because an IndexedDB write started as a page closes never finishes. The journal holds plaintext, so Milestone 7 must encrypt or remove it.
- Diary card IDs come from the vault and date, so two devices can't create two entries for one day once sync exists.
- Each account has one default vault, with no vault UI until Milestone 3.
- Backups are JSON and restore by merging, newest version of each card wins, and cards from other vaults move into the account's vault. Markdown export is one-way.
- Search treats each Chinese, Japanese or Korean character as a term, so text in those scripts can be found without spaces.
- The app is hosted on Cloudflare Pages at https://notes-app-afc.pages.dev (`npm run deploy`). It is a regular Pages project with no Git connection, so deploys are manual and pushes don't trigger them.

## Implementation notes from Milestone 2

- The Google Cloud project is `notes-app-514219`. Its consent screen is in Testing mode, and test users are added under Google Auth Platform, Audience.
- Sign-in is required. Google's ID token is verified on the server, which then issues its own 90-day session in an HttpOnly, SameSite=Strict cookie. Only a hash of the session token is stored.
- Each account has its own local database and journal, so accounts on one browser stay apart in the app. Signing out keeps that account's local data, and unsynced changes go up at next sign-in. Until encryption ships, this does not stop someone tech-savvy with the unlocked device.
- The first account to sign in on a browser takes over notes written before accounts existed, moved into that account's vault.
- A push carries the last server version the device saw. Same version: it applies. Different: the newest `updated_at` wins, and the losing text is kept as a "(conflict copy)" card. No copy is made if only a todo's status or due date or a tag differs.
- Each account's vault ID is derived from its user ID, so diary IDs match across devices.
- Who can sign up is limited by the Google consent screen while it stays in Testing mode. Publishing it would need an allowlist first.

## Implementation notes from Milestone 3

- A PIN is stored as a salted PBKDF2 verifier and syncs with the vault, so one PIN works on every device. It gates the app and is not encryption, so it doesn't protect against someone reading browser storage or the server's database until Milestone 7.
- Open vaults are held in memory only. They lock when the app goes to the background, after five idle minutes, and on reload. After five wrong PINs, attempts wait 30 seconds.
- Locked cards are removed where the index is built, so lists, search, backlinks, Today, Calendar and Markdown export can't reach them. Links into a locked vault read "Locked", and a JSON backup leaves locked vaults out.
- Each account's default vault can't be locked, because new cards go there.
- New diary entries go to the oldest private vault if there is one, otherwise the default vault. Existing entries stay where they are unless moved.
- A hidden vault is unlocked by entering its PIN under Vaults, and its name is not shown until then.
- Fingerprint unlock is per device and off by default. It uses the device's built-in authenticator through WebAuthn, and has not been tried on a real phone.
- A forgotten PIN can't be recovered yet. Vault creation and PIN changes need a connection.

## Implementation notes from version history

- The server keeps history, so every device sees the same versions and a new device gets them too. It needs a connection; offline, the page says so.
- One version covers a stretch of edits by one person: saves within 10 minutes of each other extend it, up to an hour. Both sides of a sync conflict are kept as separate versions. At most 200 versions per card.
- A card that existed before history was kept gets its earlier state saved, with no author, the first time it changes.
- History is visible to members of the card's current vault. Locked cards show the unlock panel instead, as their card page does.
- The page compares a version with the one before it, word by word (each CJK character counts as a word), or shows its full text. A line that was mostly rewritten is shown as the old line and the new one.
- Restore writes the old title, text, tags and todo fields back as a new change, so it can itself be undone. It seals the newest version first, so the restore always gets its own entry.
- Edits on this device that haven't synced yet appear as their own entry at the top.
- Ticking off a todo in a list, moving a card to another vault and moving to Trash each show Undo in a toast.
- Undo in the editor covers this device's typing only. A change arriving from sync is not undoable, so undo can't revert another device's edit. Older states are restored from history.

## Implementation notes from Milestone 4

- The MCP server is `/api/mcp` on the app's own address, using Streamable HTTP with plain JSON replies (no streaming, no sessions), so it runs as a Pages Function without Durable Objects. No MCP SDK: the server handles `initialize`, `ping`, `tools/list` and `tools/call` itself.
- Sign-in for AI apps is OAuth 2.1, built in rather than through Cloudflare's OAuth library, so it needs no KV namespace: dynamic client registration, codes with PKCE (S256), one-hour access tokens and rotating 90-day refresh tokens. Discovery documents are under `/.well-known` at the site root. Only token hashes are stored.
- Approval happens in the app at `/oauth/authorize`, which uses the normal session. The session cookie stays SameSite=Strict, because the page calls the API from the app's own origin.
- What an app can reach is set per vault (off, read, read and write) and enforced on the server. Private vaults are always off. Writes also need the user to own the vault, so shared vaults stay read only to AI.
- Every vault closed to AI goes into the AI's index as locked, so links into it read "Locked" and its text never reaches search, through the same code that hides locked vaults in the app.
- Tools: `list_vaults`, `search_cards`, `get_card`, `list_todos`, `get_diary`, `create_note`, `add_todo`, `complete_todo`, `append_to_diary`, `edit_card`. There is no delete. AI writes Markdown, which becomes the card's TipTap document; `[[Exact title]]` links to an existing card.
- AI writes go through the same push path as devices, so they sync, and their versions record the app's name ("Ann via Claude (AI)"). An AI edit never extends a person's version.
- New diary entries are refused while the diary lives in a private vault, because AI can't reach it.
- The MCP `instructions` tell the model to treat card text as data, not instructions.
- To connect Claude: Backup & settings, AI apps shows the address to add as a custom connector. Turn on AI access for a vault, under Vaults or on the approval page.

## Implementation notes from Milestone 5

- A photo is a block node in the card body holding an attachment ID. The image itself is never in the card payload.
- Photos are shrunk on the device (long edge 2048 px, JPEG at 85%; small GIF, PNG and WebP keep their format), saved in IndexedDB, and shown from there at once. An upload queue sends them when online, so photos work offline.
- The server does every Drive call, holding the owner's refresh token. Devices never get Google tokens. Members of a shared vault see photos through the server, which reads them from the owner's Drive.
- Drive access is `drive.file`, so the app sees only files it made, in a "Notes app photos" folder. Google's redirect back carries a one-time state, because the SameSite=Strict session cookie isn't sent on it.
- A photo is checked against the vault it was added in. Moving a card to another vault doesn't move its photos' access yet; members of the new vault won't see them. Handle this with sharing.
- Deleting a photo from a note leaves the file in Drive. A clean-up for unreferenced photos can come later.
- Markdown export writes `![alt](attachment:id)`, but doesn't put the image files in the zip yet.

### Turning on photo upload in production

1. In Google Cloud project `notes-app-514219`, enable the Google Drive API.
2. In Google Auth Platform, Clients, open the web client and add the authorized redirect URI `https://notes-app-afc.pages.dev/api/drive/callback` (and `http://localhost:8788/api/drive/callback` for local testing).
3. In Data access, add the scope `.../auth/drive.file`.
4. Copy the client secret and run `npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name notes-app`, pasting it when asked. For local testing, put `GOOGLE_CLIENT_SECRET=...` in `.dev.vars` (ignored by git).
5. In the app, Backup & settings, Photos, press Connect Google Drive.

## Implementation notes from Milestone 6

- Sharing a vault: its owner adds people by email as editors or viewers. Someone without an account is invited and joins at first sign-in. Members can leave. Viewers can read and comment; editors can also change, add, move and trash cards.
- Private vaults can't be shared, and a shared vault can't get a PIN, since every member would need it. Sharing private vaults with their own key is a Milestone 7 question.
- Sharing one card: with a person by email, or with everyone in another vault the sharer belongs to, for viewing, commenting or editing. Edit access changes content only; recipients can't move, trash or re-create the card. Only members who can edit the card's own vault can share it onward.
- Sharing a card into another vault shows a warning naming both vaults and how many people are in each. Sharing from a private vault needs the vault open and a confirmation.
- Public links: unlisted, read only, optional expiry (1, 7 or 30 days), revocable, at `/s/<token>`. The server strips linked cards' stored titles from the public response, and serves only photos the card contains. Until Milestone 7 the server can read public cards; then the key moves into the URL fragment.
- Recipients sync shared cards like their own. When access grows the device pulls from the start, since a newly shared card can be older than its cursor; when access ends, those cards are removed from the device.
- Links to cards the account can't see read "Not shared" everywhere, rather than the title stored when the link was made.
- Comments are server-only, so they need a connection. They show under a card once others can see it, or once it has comments.
- AI apps treat shared vaults as read only (Milestone 4), so text written by other people can't steer AI edits.
- Not done yet: notifications when something is shared, and moving a card's photos' access along with the card.

## Implementation notes from Milestone 7

- Each private vault has a random AES-256-GCM key, stored only wrapped: by a key derived from the PIN with Argon2id (19 MiB, 2 passes, via hash-wasm 4.12.0), and by a recovery key shown once. The server and devices never store the vault key unwrapped.
- A card in an encrypted vault is encrypted on the device as it is written, bound to its ID and vault. IndexedDB, the server, version history and conflict copies hold only ciphertext (`e1:` payloads). The server refuses plaintext into an encrypted vault.
- Unlocking unwraps the key, which also checks the PIN. Keys live in memory only and are forgotten when the vault locks. Fingerprint unlock keeps a non-extractable copy of the key on that device.
- Edits to encrypted cards skip the plaintext crash journal. A crash mid-save can lose the last few hundred milliseconds of typing in a private vault, rather than leave it readable.
- New private vaults are encrypted from the start. A private vault from before Milestone 7 shows "Encrypt this vault"; doing so re-stores every card encrypted and purges the plaintext versions from the server's history.
- Forgot PIN: the recovery key opens the vault and sets a new PIN. Changing the PIN rewraps the same key. Removing the PIN decrypts the vault.
- The PIN is the weak point: anyone with a copy of the server database can try PINs offline, so a 4-digit PIN falls in under an hour. A longer passphrase is much stronger. Worth a warning in the app later.
- Not covered yet: photos in private vaults are not encrypted in Drive or on the device; cards in encrypted vaults can't be shared or published (they need per-card keys, with the key in the link's `#` fragment); open vaults rely on Cloudflare's encryption at rest rather than their own key.

## Implementation notes from the journal

- The stream orders notes and todos by when they were created, so editing doesn't move them, and groups them under day labels. A diary entry sits at the time it was started, or at the end of its day if it was written on another day.
- Card types stay as they were (note, todo, diary, tag), so sync, MCP and the native apps are unchanged; only the web app's screens changed. The markers are read when the box is saved (`src/domain/entry.ts`), and `#todo` and `#diary` never become tags.
- Web addresses typed in the box become links. The links filter finds addresses in links and in plain text alike (`linkUrls`), so older notes count too.
- A weekday date (`@fri`) means the next one after today, so `@thu` on a Thursday is a week away.
- The filter lives in the address (`/journal?type=todo&status=today&tag=…&vault=…&when=week&sort=due`), so the back button and bookmarks work. `/today` and `/upcoming` redirect to their filters, and Calendar days open the journal for that day.
- A tag's own page (rename, describe, pin) is still at `/card/:id`, reached from the tag button at the top of a tag-filtered journal or from All tags.
- New entries take the filter's tag and vault; a todo filter makes the box write todos, and "Due today" makes them due today. A tag created from the box goes in the default vault.
- With the diary locked, a `#diary` line stays in the box and the vault's PIN is asked for above it.
- The box is a small TipTap editor (`JournalBox`). On saving, `entriesFromDoc` reads its rich text: each checkbox is a todo and the blocks between them one note, with formatting, links and photos kept. Checkbox lists never end up inside a note, so the note editor needn't support them. Enter saves on a computer, Shift+Enter starts a new line (the next checkbox in a list), and Cmd+Enter saves anywhere.
- The command box still reads plain text (`parseEntries`). One text can hold several entries. A new tag typed in several of them is made once, `#diary` parts go into the diary in one save, and if part of the text can't be saved (the diary is locked) none of it is. Cards made together get creation times a millisecond apart, so they keep the order they were typed in.
- Notes and todos open at `/journal/:id` in a sheet over the page they were opened from (Search, Calendar, a filtered journal), so the back button closes it. Old `/notes/:id` and `/card/:id` links to notes and todos redirect there.
- The box saves on Enter on a computer (Shift+Enter for a new line). On a phone, Return makes a new line and the send button saves.
- A batch change skips entries it doesn't apply to (a due date on a note) or that already match, and entries this account can't change, which the toast counts. Undo puts back each entry's own earlier value. Picks that fall outside a new filter are kept but not counted or changed.
- Link previews come from `POST /api/unfurl {url}`: the server reads at most 256 KB of the page within 5 seconds, takes its Open Graph tags or `<title>`, and caches the result for a day. It fetches only public web addresses on ports 80 and 443, following up to three redirects itself and checking each one, so it can't be pointed at the server's own network. The address goes in the request body so it stays out of logs.
- The app keeps each preview on the device for a week (a page that gave nothing is asked again after an hour). Links in encrypted vaults are never previewed, so those addresses don't leave the device. A preview's image loads straight from the page's site, with no referrer.
- In the command box, text with markers (`[]`, `#tag`, `@friday`) offers saving first; other text lists matching commands, then matching notes, then saving. Commands whose name matches come before ones that match by keyword.
- The native apps still have the earlier layout; they follow once the web design settles.

## Implementation notes from the native apps

- The Apple app is in `apple/`: `NotesKit` is a Swift package with the models, SQLite storage, repository, sync engine, API client and crypto, tested with `swift test`; `Notes/` is the SwiftUI app. XcodeGen makes the Xcode project from `project.yml`.
- Card payloads stay raw JSON on the device (`JSONValue`), so fields the native app doesn't know about survive its saves. The SQLite store mirrors the web store: a local write marks the card dirty, and a remote change never overwrites a dirty card.
- Sign-in reuses browser pairing: the app starts a pairing, opens `/pair?p=…&return=app` in a web authentication sheet, and polls until it can claim the session with `token: true`. The server then returns the session as a bearer token instead of a cookie, and the app keeps it in the Keychain. After approving, the page sends the browser to `notesapp://paired`, which closes the sheet.
- Encryption matches the web app byte for byte: AES-256-GCM through CryptoKit, and Argon2id (with BLAKE2b) written in Swift, since Apple's frameworks don't have it. Both are tested against RFC vectors and against values made by the web code.
- The editor is SwiftUI's rich `TextEditor`. Inline formatting is real rich text; blocks are visible markers at the start of a line (`# `, `• `, `1. `, `> `, code fences, `---`). Card links are `notes-card://` links. Photos and anything else the app can't show become placeholders that keep the original node, so nothing written on the web is lost by editing natively.
- The Mac app is called "Notes App" so it can't be confused with Apple's Notes; on the iPhone home screen it is "Notes". The bundle identifier is `dev.notesapp.notes`, signed with the owner's Apple development team.
