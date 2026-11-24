# Parity: the native apps against the desktop web app

The desktop web app is the standard. Each row is one thing the web app does, and how the Mac app, the iPhone app and
the Android app do it. The phone apps are held to the web app on a phone where its two layouts differ (a tap opens, a
long press picks, Tags and vaults and the account's picture take the sidebar's place).

- ✅ the same
- ⚠️ there, but different (the note says how)
- ❌ missing
- ➖ doesn't apply on that platform (a mouse or keyboard behavior on a phone)

**How each row was checked**, in its last column: **T** tried in the running app against the demo account, side by
side with the web app; **C** read in the code side by side with the web's; **?** not checked yet.

Local testing: run `npm run dev` and point the native apps at `http://localhost:5191`, not at the API on 8788, or the
demo's photos, videos and voice messages won't load (the README says how). That was why photos and voice messages
seemed broken on the Mac and iPhone: the API answers 503 for the demo's files, which only the dev server serves.

_Last checked 2026-11-23._

## Journal: bubbles

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| A tag on a bubble is a label; pressing it does what pressing the bubble does | ✅ | ✅ | ✅ | C |
| Double-click opens an entry, ready to type (mouse) | ✅ | ➖ | ➖ | T |
| A tap opens an entry (touch) | ➖ | ✅ | ✅ | T |
| A long press picks the entry (touch); there's no menu on touch, its actions are in the open entry and the picking bar | ➖ | ✅ | ✅ | T |
| Right-click opens the entry menu (mouse) | ✅ | ➖ | ✅ with a mouse | C |
| A mouse click leaves the bubble's text to select; a right-click on selected words offers Copy, New note, Search Google, Translate | ❌ the Mac's bubble text isn't selectable, so a double-click opens it | ➖ | ➖ | C |
| Cmd-click picks; Shift-click picks a range | ✅ | ➖ | ➖ | T |
| A click beside a bubble picks it | ✅ | ➖ | ➖ | T |
| A drag from empty space picks with a box | ❌ | ➖ | ➖ | C |
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
| A button back to the newest entries | ? | ? | ? | ? |
| A rail down the right with the years, to point at and drag | ⚠️ | ⚠️ | ⚠️ | ? |

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
| Pasting keeps formatting; a chip offers Markdown or plain instead | ❌ | ❌ | ❌ | C |

## Open entry

| Web behavior | Mac | iPhone | Android | How |
|---|---|---|---|---|
| Over the dimmed page, as tall as what's in it; a click outside or Esc closes it | ✅ | ➖ | ➖ | T |
| On a phone: a sheet from the foot as tall as what's in it, over the dimmed page; a tap above closes it; no Done | ➖ | ✅ | ✅ | T |
| Photos, voice messages and files show in the open entry | ⚠️ under the text, not in it; the text names them ([Photo], [Voice message], [File: name]) | ⚠️ the same | ⚠️ the same | T |
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
| ↑ ↓ Home End move between entries, Space picks, Return opens, Delete trashes, Esc stops picking | ✅ | ➖ | ➖ | C |
| ← → turn the focused entry's pages; Cmd+V pastes copied entries | ❌ | ➖ | ➖ | C |
| Right-click with several picked: Copy, Cut, Stop selecting, Archive, Move to Trash | ✅ | ➖ | ➖ | C |

## Not checked yet

Sharing and public links; reminders; translating.
