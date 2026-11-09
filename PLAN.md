# Notes app: plan so far

`notes-app` is a working name. A real name will be picked before the app is shared with anyone.

## Goal

One local-first tool for all personal notes, todos and diary, used on an Android phone and a Mac mini. It may later be shared with other people (family, high school classmates, etc.).

Privacy goal: keep notes private from friends and family. Not defending against forensic or state-level attackers.

Existing apps were considered (Notesnook is the closest, then Anytype, then Obsidian with Meld Encrypt). The owner chose to build their own, as one tool for every need.

## Product decisions

### Cards
Everything is a card: `note`, `todo`, `diary`, `tag`.

- Todo adds status and due date. Main views: Today, Upcoming.
- Diary adds a date, one entry per day. Main view: Calendar / daily page. Defaults to a private vault.
- Links and backlinks are in scope. Canvas/whiteboard is NOT needed for now.

### Labels are notes
A label is a card of type `tag`, with its own description and links. Tagging a note is a typed link to the tag card, so the tag card's backlinks list every tagged note.

### No folders
There is no separate folder or collection concept. A folder is a tag card pinned in the sidebar. A note can carry many tags, so it can sit in several "folders" at once.

### Vaults
A vault answers "who can see this". Topics belong in tags, not vaults.

- Each card has exactly one home vault.
- A vault named after a group (e.g. "High school") only makes sense if those people are members, or it needs its own PIN.
- Set per vault: lock (none or PIN), AI access (off, read, read + write), members.
- When locked: left out of UI, search, backlinks and the Today view. Links to its notes show as "Locked". A vault can be fully hidden until unlocked.
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
- Write access is approved by the owner.
- Tools, read: `search_cards`, `get_card` (with backlinks), `list_todos(due, status)`, `get_diary(date range)`.
- Tools, write: `create_note`, `add_todo`, `complete_todo`, `append_to_diary`, plus editing existing notes.
- Every AI edit creates a version labeled as AI-authored, undoable in one click.
- Notes shared with you by others are read-only to the AI, because they could contain text written to manipulate it.

### Encryption: later, but design for it now
- The server only stores opaque records. Plain fields: `id, vault_id, updated_at, deleted, seq`. Everything else goes in one `payload` field: JSON now, ciphertext later, with no server change.
- Search index and backlinks are derived on each device and never synced. (Exception: open vaults with AI access can be searched server-side, e.g. D1 FTS5, for MCP.)
- Later crypto: password through Argon2id to a key-encryption key, which wraps a random AES-GCM key per vault. Each card gets its own key wrapped by the vault key, so sharing one note means sharing only that note's key. Public links keep the key in the URL `#` fragment. Print a one-time recovery key.
- Open vaults: server-side encryption at rest. Private vaults: end-to-end.

Until encryption ships, a tech-savvy person with the unlocked laptop could read browser storage. Accepted for this threat model.

## Technical decisions

- **Client:** PWA first. React, TypeScript, Vite, vite-plugin-pwa, Dexie (IndexedDB), TipTap editor with `[[link]]` autocomplete, MiniSearch.
- Keep storage and crypto behind small interfaces so the same UI can later be wrapped in Tauri 2 (macOS and Android).
- Call `navigator.storage.persist()`. Build export/backup early, including Markdown plus image files.
- **Note format:** TipTap JSON stored in the card, plus Markdown export. Links by card ID survive renames, and it supports comments and live co-editing through Yjs.
- **Sync server:** hosted, not on the Mac mini. Cloudflare Worker (Hono) with D1. `POST /sync/push` assigns an increasing `seq`; `GET /sync/pull?since=<seq>`. Conflict: newest version per card wins, the loser is kept as a conflict copy. Avoid sync engines that need to read the data (PowerSync, Dexie Cloud); avoid Supabase free tier, which pauses when inactive.
- **Auth:** Google sign-in. Single user at first, but multi-user in the data model from day one; every request checks vault membership.
- **Photos:** stored in Google Drive, behind a storage interface, with cards referencing their own attachment ID. Offline photos queue on the device and upload later, with small previews cached locally.
  - Uses the `drive.file` scope; the Worker does the one-time OAuth login and holds the refresh token, handing the app short-lived tokens so the phone isn't re-prompted hourly.
  - Known consequences, to handle at Milestones 5 and 6:
    - Photos from private vaults sit in the owner's Drive, where anyone who can open their Drive app could see them until encryption ships.
    - Shared vaults need a way for members to read the owner's photos (Drive permissions per person, or the Worker serving them with the owner's token).
  - Cloudflare R2 was considered (10 GB free, no download fees, simpler for shared vaults). The storage interface keeps it possible as a later backend.

## Data model

```
User         id, email
Vault        id, owner_id, lock(none|pin), ai_access(off|read|write)
VaultMember  vault_id, user_id, role(owner|editor|viewer)
Card         id, home_vault_id, type(note|todo|diary|tag), payload(TipTap JSON + fields)
Share        card_id, target(vault|user|public_link), role(view|comment|edit), expires_at
Comment      id, card_id, author_id, anchor, body
CardVersion  card_id, payload, author(user|ai), at
```

Links and tag associations live inside the card payload.

## Milestones

1. Works on one device: notes, todos, diary; tags, links and backlinks; search; Today and Calendar views; installable PWA.
2. Sync and accounts: Worker and D1, Google sign-in, multi-user data model (only the owner using it).
3. Private vaults: PIN, optional fingerprint, auto-lock, hidden from search.
4. MCP server.
5. Photos.
6. Sharing vaults and single notes (roles, comments, public links).
7. End-to-end encryption for private vaults.

Later: push reminders for todos, Tauri wrapper if PWA limits hurt.

## Resolved questions

1. Folders: dropped as a separate concept. A folder is a tag card pinned in the sidebar.
2. Photos: Google Drive. Consequences are listed under Technical decisions.
3. Name: `notes-app` stays the working name. Pick a real name before sharing it with anyone. The folder stays `~/Projects/notes-app` even after that.
4. Note format: TipTap JSON plus Markdown export, confirmed.
5. "Global" sharing: an unlisted "Anyone with the link" URL, confirmed.

## Open questions

None. Next step is Milestone 1, once the owner says to start.
