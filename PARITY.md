# Parity: the native apps against the desktop web app

The desktop web app is the standard. Each row is one thing the web app does, and how the Mac app, the iPhone app and
the Android app do it. The phone apps are held to the web app on a phone where its two layouts differ (a tap opens, a
long press picks, Tags and vaults and the account's picture take the sidebar's place).

- ✅ the same
- ⚠️ there, but different (the note says how)
- ❌ missing
- ➖ doesn't apply on that platform (a mouse or keyboard behavior on a phone)

**How each row was checked**, in its last column: **T** tried in the running app against the demo account, side by
side with the web app; **C** read in the code side by side with the web's; **?** not checked yet. A **C** is not proof:
on 2026-11-25 two rows marked ✅ turned out wrong once tried (Esc in a Mac open entry, Cmd-click while picking).

**Keeping it current.** Every change to how the web app behaves rewrites its row here, in the same commit, and marks the
native apps that no longer match; every native change updates that app's cell, with **T** only once tried. The rows
were rebuilt on 2026-11-25 from the whole git history (every web commit since 2026-11-10, later ones over earlier
ones) and the web app as it runs today.

Local testing: run `npm run dev` and point the native apps at `http://localhost:5191`, not at the API on 8788, or the
demo's photos, videos and voice messages won't load (the README says how). That was why photos and voice messages
seemed broken on the Mac and iPhone: the API answers 503 for the demo's files, which only the dev server serves.

_Last checked 2026-11-25._

## Journal: bubbles

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| A tag on a bubble is a label; pressing it does what pressing the bubble does | ✅ | ✅ | ✅ | C |
| Double-click opens an entry, ready to type (mouse) | ✅ | ➖ | ➖ | T |
| A tap opens an entry (touch) | ➖ | ✅ | ✅ | T |
| A long press picks the entry (touch); there's no menu on touch, its actions are in the open entry and the picking bar | ➖ | ✅ | ✅ | T |
| Right-click opens the entry menu (mouse) | ✅ | ➖ | ✅ with a mouse | C |
| A mouse click leaves the bubble's text to select; a right-click on selected words offers Copy, New note, Search Google, Translate | ✅ (since 2026-11-25; Copy has no chip for the other styles, as no copy on the Mac has yet; Shift with the right-click gives the Mac's own text menu, as the browser's on the web) | ➖ | ➖ | T |
| Cmd-click picks; Shift-click picks a range, on the bubble or the circle; a double-click while picking, or with a key held, doesn't open | ✅ (since 2026-11-25; before, a Shift-click on the bubble did nothing and a double-click while picking opened it) | ➖ | ➖ | T |
| A click beside a bubble picks it | ✅ | ➖ | ➖ | T |
| A drag from empty space picks with a box, beside the stream too, picking as it moves; Shift or Cmd adds to what's picked | ✅ (since 2026-11-25) | ➖ | ➖ | T |
| A click on empty space stops picking | ✅ (since 2026-11-25) | ➖ | ➖ | T |
| Pointing at a bubble shows a copy button in its corner | ✅ | ➖ | ➖ | C |
| Pointing at a bubble shows the pick circle on its left; while picking every circle shows | ✅ | ➖ | ➖ | T |
| A smiley at the start of the bottom row adds a reaction, from six common ones, then + for search, Recent and every group | ✅ | ✅ | ✅ | T |
| A comment button beside the smiley, on an entry others can comment on that has no open comments | ✅ | ✅ | ✅ | T |
| Open comments show as a count that opens the entry | ✅ | ✅ | ✅ | C |
| Checklist progress (done/total), green when all done | ✅ | ✅ | ✅ | C |
| Page number and ‹ › down the sides of a card with pages | ✅ | ✅ | ✅ | C |
| More / Less folds a long entry | ✅ | ✅ | ✅ | T |
| Vault names in the bottom row, a lock on a private one; "Shared with you" | ✅ | ✅ | ✅ | T |
| A clock on an entry not on the server yet; a warning once syncing has failed | ✅ | ✅ | ✅ | C |
| An eye on an entry set to view only | ✅ | ✅ | ✅ | T |
| Tags on the left, a todo's dates on the right, red once overdue, ↻ for a repeat | ✅ | ✅ | ✅ | T |
| A waiting todo: dashed box and a Waiting mark | ✅ | ✅ | ✅ | C |
| Ticking a todo's box finishes it (a repeating one moves on) | ✅ | ✅ | ✅ | C |
| Hidden words as dots until pressed; each press shows or hides that stretch | ⚠️ the dots don't drift | ⚠️ the dots don't drift; shown words take the link color | ⚠️ the dots don't drift | T |
| Links in the text open | ✅ | ✅ | ✅ | T |
| Code: indents kept, the language named, a copy button | ⚠️ not colored by language | ⚠️ not colored | ⚠️ not colored | C |
| A template shows Use it | ✅ | ✅ | ✅ | C |
| Photos under the bubble, whole, in rows; the last of five says +N | ✅ | ✅ | ✅ | T |
| Files as chips with size and type; open, share and download | ✅ | ✅ | ✅ | C |
| Link previews as cards, one line or off | ✅ | ✅ | ✅ | T |
| Reactions under the entry with counts; press one to add or take off yours | ✅ | ✅ | ✅ | T |
| Right-click on a photo: Open entry, Show in journal, Copy photo, Share via public link | ✅ | ➖ | ➖ | C |

## Voice messages

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Play and pause; the waveform fills as it plays and seeks where it's pressed | ✅ | ✅ | ✅ | T |
| Speed 1×, 1.5×, 2× | ✅ | ✅ | ✅ | T |
| One volume for all of them, from a speaker button: a click mutes on a computer, the slider shows on hover; a tap shows it on a phone | ✅ | ✅ | ✅ | T |
| Each evened out to the same loudness | ❌ | ❌ | ❌ | C |
| One plays at a time, and runs on to the next in the same entry or the next one | ✅ | ✅ | ✅ | C |
| A bar along the top of the journal while one plays: previous, play, next, what's said, time, speed, volume, close, a line to seek | ✅ | ✅ | ✅ | T |
| Transcript: each sentence plays from there, the one being said marked; hidden or shown from the player, kept on the device | ✅ | ✅ | ✅ | T |
| Copy and Transcribe again under the transcript | ✅ | ✅ | ✅ | T |

## Journal page

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Title bar on a computer: count, Demo, sync state, eye, search, order, board switch | ⚠️ the count is a subtitle; no Demo tag by the title | ➖ | ✅ on a tablet | T |
| Every page shows the sync state, and the eye where something can be changed (not Settings, Vaults, Photos, Links, Files) | ✅ | ✅ | ✅ | T |
| Title bar on a phone: sync, eye, search, order, Tags and vaults, the account's picture; no sidebar | ➖ | ✅ | ✅ | T |
| Tags and vaults on a phone: the pages, groups, tags and vaults in a sheet, with Done | ➖ | ✅ | ✅ | T |
| A group, Tags and Vaults fold from their names, keeping the one in use in sight | ✅ | ✅ | ✅ | T |
| The account's picture on a phone: the account, others to switch to, Add another account, Backup & settings, Sign out | ➖ | ✅ | ✅ | T |
| Phone tabs are links: Journal goes to the whole journal; a page picked elsewhere shows | ➖ | ✅ | ✅ | T |
| The order menu also picks a board; on a board it names the columns | ✅ | ✅ | ✅ | T |
| Eye: view only for the whole app, the box replaced by "View only… Turn off" | ✅ | ✅ | ✅ | T |
| Picking: Select all and Done in the title bar; a bar of N selected, Tags, Done, Not done, Waiting, Due date, Make todos/notes, Move to…, Stack, Copy, Archive, Trash, × | ✅ | ✅ | ✅ | T |
| Filter row: All, Notes, Todos, Stacks; Todos status; Written dates; Contains; Templates | ✅ | ✅ | ✅ | T |
| Day badges, pinned while their day scrolls past | ✅ | ✅ | ✅ | T |
| A round button back to the newest entries (the end the journal opens at), shown once well away from it, above the writing box | ✅ (since 2026-11-25) | ✅ (since 2026-11-25) | ✅ (since 2026-11-25; the distance is estimated from the rows drawn) | T |
| A rail down the right of the Journal, Archive and Templates, the Trash, Photos, Links and Files, with the years (or months, or days) by where their items fall, a thumb at where the page is, to point at, press and drag | ✅ (since 2026-11-25 on all six; before, the journal's gave each month an equal share and the others had none) (T) | ✅ (since 2026-11-25 on all six, as the web's on a phone: a handle at the edge while the page scrolls, held and dragged, with the marks and the month or day shown while dragging; the journal's by how far it's scrolled) (T: the journal's handle) | ✅ (since 2026-11-25 on all six, as the web's on a phone: a handle at the edge while the page scrolls, held and dragged, with the marks and the month or day shown while dragging; before, only the journal had one, each month an equal share) (T: the Journal, Photos and the Trash) | T |
| A long journal draws 150 entries at a time, and more by itself as the reader scrolls toward them, keeping in place what's on screen as earlier ones come in above | ✅ (since 2026-11-26; before, Show earlier entries had to be pressed) (T) | ✅ (since 2026-11-26, the Mac's code) (C) | ✅ (since 2026-11-26; before, the button had to be pressed) (T) | T |
| Each page, and each view of the journal (a tag, a vault, the Archive, a sort), opens where it was left while the app stays open: by the entry or item at the top of the screen and how far down it was; one left at its newest opens at the newest again; another page opens at its top, not wherever the last one was scrolled to | ✅ (since 2026-11-26, the iPhone's code: the journal and the Trash tried) (T) | ✅ (since 2026-11-26) (T) | ✅ (since 2026-11-26; the journal tried, the Trash, Photos, Links and Files the same code) (T) | T |

## Journal box

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Placeholder "Write a note · [] todo · #tag · / for more" | ✅ | ✅ | ✅ | T |
| Enter saves, Shift+Enter a new line; on a phone Return is a new line and the arrow saves | ✅ | ✅ | ✅ | C |
| `#` suggests tags, with a new one offered | ✅ | ✅ | ✅ | T |
| `@` suggests today, tomorrow, the next six weekdays, a typed time and repeats | ✅ | ✅ | ✅ | T |
| `/` lists what can be added | ✅ | ✅ | ✅ | T |
| Typed `- `, `1. `, `> `, `#` become lists, quotes and headings | ✅ | ✅ | ✅ | C |
| A draft is kept per view and follows the account to its other devices | ✅ | ✅ | ✅ | C |
| Pasting keeps formatting; a chip offers Markdown or plain instead | ❌ the editor keeps formatting, with no choice | ❌ the same | ❌ the editor takes plain words only | C |
| Buttons for a todo, a photo or video, a file and a voice message, beside Save | ✅ (T) | ✅ | ✅ | C |
| A pasted picture, or a picture's address alone, becomes a photo; typing goes on after it | ? | ? | ? | ? |

## Open entry

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Over the dimmed page, as tall as what's in it; a click outside or Esc closes it | ✅ (Esc since 2026-11-25: the journal behind kept the keys, and a second Esc closed the whole window) | ➖ | ➖ | T |
| On a phone: a sheet from the foot as tall as what's in it, over the dimmed page; a tap above closes it; no Done | ➖ | ✅ | ✅ | T |
| Photos, voice messages and files show in the open entry, where they are in the text | ✅ (since 2026-11-25; before, under the text, named in it; Remove from the entry in each one's menu, where the web selects it and deletes) (T) | ✅ (since 2026-11-25, the same) (T) | ✅ (since 2026-11-25; a photo's menu on a long press, a file's or voice message's from the ⋮ beside it, with Remove from the entry) (T) | T |
| Grouped tag opens its group to switch it; "+ Priority" for a group it has none of; other tags are labels | ✅ | ✅ | ✅ | T |
| Bar: make it a todo/note (showing what it makes it), Aa, Tags, a page, title, color, view only, template, copy, share, archive, trash, vault; Edited, Undo, Redo, Discard | ✅ | ✅ | ✅ | T |
| Comments only where someone else can read them | ✅ | ✅ | ✅ | T |

## Photos

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Viewer over the whole window: entry and day at the top (opens it), close, ‹ ›, "1 / 19", a strip of all of them | ✅ | ✅ | ✅ | T |
| Arrows page, Esc closes, + − 0 zoom (keyboard) | ✅ | ➖ | ➖ | C |
| A swipe pages (touch) | ➖ | ✅ | ✅ | C |
| Photos page: All/Photos/Videos, rows by day, count line | ✅ | ✅ | ✅ | T |
| Photos page: pick photos to copy, download or share | ✅ | ✅ | ✅ | C |
| Photos page: tiles at each photo's shape before it loads, from the size its block keeps (added since 2026-11-26), so nothing moves as they load | ✅ | ✅ | ✅ | C |
| Videos play under their entry, full screen and in the open entry, marked with their length | ✅ | ✅ | ✅ | C |
| A photo, video or file shared by its Google Drive link (Share via public link) | ✅ | ✅ | ✅ | C |
| Files page: one kind of file at a time (PDFs, documents, spreadsheets, slides, audio, images, video, archives, other) | ✅ | ✅ | ✅ | C |

## Pages

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Board: drag cards between columns and within one (a finger by the card's grip), scrolling near the sides; add a card in a column | ✅ | ✅ | ✅ | T |
| Calendar: a month with bars for spans, a todo dragged to another day (with a mouse; the web can't drag there with a finger either), the day's list below | ✅ | ✅ | ⚠️ no dragging on a tablet | C |
| Timeline: bars dragged or stretched | ✅ | ✅ | ✅ | C |
| Calendar on a phone: counts per day, Today, the day's todos and Written this day | ➖ | ✅ | ✅ | T |
| Search: words across notes, todos and tags | ✅ | ✅ | ✅ | T |
| Links and Files: a search button opens a field under the filters | ✅ | ✅ | ✅ | T |
| Links, Files, Trash, History, Tags and Vaults on a phone, against the web's | ➖ | ✅ | ✅ | T |
| "Today" moves on at midnight in an app left open | ✅ | ✅ | ✅ | C |
| Backup & settings: account, backup, import, reminders, journal display, copy as, photos and files, AI apps, delete account | ✅ | ✅ | ✅ | T |
| Backup & settings: Paste as (keep formatting, Markdown, plain) | ❌ | ❌ | ❌ | T |

## Everywhere

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Cmd+K: commands and search | ✅ | ➖ | ➖ | C |
| `?` lists the shortcuts | ✅ | ➖ | ➖ | C |
| Cmd+Z undoes the last change anywhere, Cmd+Shift+Z redoes | ✅ | ➖ | ➖ | C |
| ↑ ↓ Home End move between entries, Space picks, Return opens, Delete trashes, Esc stops picking; with none focused, ↑ ↓ and Space start from the entry in the middle of the screen; Shift ↑ ↓ picks from the entry it starts on | ✅ (the middle and Shift's start since 2026-11-25) | ➖ | ➖ | T |
| ← → turn the focused entry's pages | ✅ | ➖ | ➖ | C |
| Cmd+V outside a text field stops picking and puts what's pasted in the writing box (copied entries come back whole there) | ✅ | ➖ | ➖ | T |
| Right-click with several picked: Copy, Cut, Stop selecting, Archive, Move to Trash | ✅ | ➖ | ➖ | C |

## Entries and todos

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| The entry menu, in order: Edit, Tags…, Make it a todo (or a note), a color, Translate, Save as template, Share…, View only, Vaults…, Take out of the stack, Archive, Move to Trash, each only where this account may | ✅ | ✅ | ✅ | C |
| An untitled entry or stack is named by its first line | ✅ | ✅ | ✅ | C |
| A todo has a due date and maybe a time, a start date shown until the day it starts, and a repeat; ticking a repeating one moves it on | ✅ | ✅ | ✅ | C |
| Waiting: a todo leaves what's due without being done | ✅ | ✅ | ✅ | C |
| Archive puts any entry away without trashing it; the Archive page holds them | ✅ | ✅ | ✅ | C |
| Save as template saves a copy among the templates (the Templates filter), where Use it starts a new entry from it | ✅ | ✅ | ✅ | C |
| Stack: picked entries become one, in an order of their own; Take out of the stack from the entry's menu | ✅ | ✅ | ✅ | C |
| An open stack's cards are dragged into a new order | ? | ? | ? | ? |
| Add a page behind the first; numbered pages, turned with ‹ › round from the last to the first | ✅ | ✅ | ✅ | C |
| Each entry's color and its preview style (Color and previews) | ✅ | ✅ | ✅ | C |
| Undo in the toast after ticking a todo, moving or trashing an entry | ✅ | ✅ | ✅ | C |
| The date picker: a day or a range of days, a month or a year, a length of days from the picked day; opened from Written or a day's badge | ✅ | ✅ | ✅ | C |
| A conflict keeps the losing side, its other pages too, as a copy | ✅ | ✅ | ✅ | C |
| A translation shows in the entry's words' place, with "From Japanese · Show original · Save as a page", or "Show in English" once put aside | ✅ | ✅ | ✅ | C |

## Vaults and privacy

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Vaults page: each vault with its count and its state (Locked, Encrypted, Needs your PIN, waiting to be let in); Create vault; Hidden vaults: Unlock | ✅ | ✅ | ✅ | C |
| A vault's page: its entries with New note here, then Settings: Rename, Make private, Encrypt end to end, AI access (Off, Read, Read and write), People with their roles (Can edit, Can view and comment), Remove, Share | ✅ | ✅ | ✅ | C |
| A private vault: a PIN lock, Change PIN, Remove PIN, Hide this vault until it is unlocked | ✅ | ✅ | ✅ | C |
| Encrypt end to end: a recovery key shown once, which recovers a forgotten PIN; its photos and files sealed on the device too | ✅ | ✅ | ✅ | C |
| In a shared vault each member can lock it with a PIN of their own, and an owner can require one of everyone; in an encrypted one a member sets a PIN and asks, and the owner lets them in; everyone sees a code made from its key to compare | ✅ | ✅ | ✅ | C |
| Every open vault locks after five idle minutes and when the app goes to the background | ✅ (since 2026-11-25) clicks and keys keep it open; a minimized window, the app hidden, or the screen sleeping or locking locks it (T) | ✅ (since 2026-11-25) touches keep it open; the Home Screen locks it (T) | ✅ (since 2026-11-25) touches keep it open; Home and the screen going off lock it, but not a picker or browser tab the app opened itself (T) | T |
| After five wrong PINs, the next try waits 30 seconds ("Too many tries. Wait 30 seconds and try again."); a wrong one says "That PIN isn't right." | ✅ (since 2026-11-25; the iPhone's code, tried there: the Mac's test tools can't type in a PIN field) | ✅ (since 2026-11-25) | ✅ (since 2026-11-25) | T |

## Sharing and comments

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Share an entry with people, a vault's members (after saying where it goes) or a read-only link; a private vault's entry asks first | ✅ | ✅ | ✅ | T |
| Share a vault: invite by email with a role, see waiting invites, change each one's access | ✅ | ✅ | ✅ | C |
| An entry can be in several vaults (Vaults…); one shared with a vault shows in that vault's journal | ✅ | ✅ | ✅ | C |
| A read-only public link opens a page anyone can read, with its photos and videos | ➖ the link opens in the browser | ➖ | ➖ | C |
| A comment written but not sent is kept for each entry on the device; resolved comments hide behind Hide resolved | ✅ | ✅ | ✅ | C |

## History and undo

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| An entry's version history, from the "Edited" date in the open entry: every version with who, which device or which AI app made it, compared with the one before, and Restore | ✅ | ✅ | ✅ | C |
| History page: this device's changes and those from other devices, AI apps and people, with filters; undo one; Undo and Redo reach back through the newest 500 | ✅ | ✅ | ✅ | C |

## Accounts and settings

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Several accounts signed in at once, switched from the account's picture; Add another account | ✅ | ✅ | ✅ | C |
| Backup: Download backup, Restore from backup, Export as Markdown; Import Markdown files or a zip | ✅ | ✅ | ✅ | C |
| AI apps: the connector address to add in Claude and other AI apps; the apps connected, each to disconnect | ✅ | ✅ | ✅ | C |
| Reminders: the web's words; This device with Turn on reminders, Turn off and Send a test; Todos with a time; Todos with only a date | ✅ | ✅ | ✅ | C |
| Storage: whether the browser has agreed to keep the notes | ➖ | ➖ | ➖ | C |
| A new version is looked for every half hour and on coming back, and offered with Reload | ➖ the apps update as releases | ➖ | ➖ | C |

## The platform's own way

The native apps should do what the web does the way their platform does it, not copy how a web page has to do it.
Reviewed 2026-11-24, after Android's sign-in turned out to send people to Chrome for no reason.

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Sign in with Google | ✅ Apple's sign-in sheet goes straight to Google with the app's own client, then the browser once it's closed (C: the same code as the iPhone) | ✅ the same (T: the sheet opens accounts.google.com, and closing it offers the browser; Google accepts the client and its return address) | ✅ the phone's own Google account picker; the browser too once the picker is closed, for an account kept off the phone | T |
| Connect Google Drive for photos and files, and come back to Settings saying how it went | ✅ in Apple's sign-in sheet, which Google's answer closes (it used to open Safari and end on the web app's Settings page) | ✅ the same | ✅ the browser comes back to the app at `notesapp://drive` (it used to stay on the web app's Settings page) | C |
| Unlock a vault with the device's fingerprint: off until turned on, one vault at a time and one device at a time, in that vault's lock settings (Unlock with fingerprint, which keeps an encrypted vault's key on the device) | ✅ Touch ID, asked before the key is read from the Keychain (C) | ✅ Face ID, asked as the locked vault shows; the key is in a Keychain item only Face ID opens (T) | ✅ Android's fingerprint sheet, asked as the locked vault shows; the key is sealed with a Keystore key only a fingerprint opens, which adding a fingerprint throws away (T) | T/C |
| A due todo's reminder comes even when it was made on another device and this one hasn't been opened since (the server pushes it) | ⚠️ while the app runs, it syncs once a minute; closed, nothing syncs | ✅ iOS wakes it to sync now and then (background app refresh), which sets its reminders again; iOS decides how often (C) | ✅ WorkManager syncs about every half hour with the app closed, and sets its reminders again (T: a todo added on the web got its alarm with the app's process killed) | T/C |
| A long press that picks gives a small vibration (touch) | ➖ | ✅ | ✅ Compose's long click does it | C |

## Not checked yet

Rows marked **?** above, still to try in each app: a pasted picture or
picture address becoming a photo, and dragging an open stack's cards into a new order. Rows marked **C** were read in
the code, not tried, so they're next once these are done.

Missing in all three native apps, found on 2026-11-25: Paste as. Restyling a paste after the editor has taken it
means reading the clipboard again, which on the iPhone asks "Allow Paste?" every time (and newer macOS is moving the
same way), so it waits on a design that takes the paste itself; a first try is kept in `.git/paste-as-wip.patch`. (Locking open vaults by themselves, the wait after
wrong PINs and the button back to the newest entries, found the same day, are done.)
