# Performance

How fast each app is with a real person's amount of notes, measured, so it needn't be measured again to know: what
was tried, how, the numbers before and after each fix, and what's still slow. Measure again after a change that could
move these numbers, and update this file with the new ones and the date.

_Last measured 2026-11-26._

## The data

The demo account (`npm run demo`) with its years of history (`scripts/demoHistory.ts`): 10,197 cards for Demo, of
which 8,999 show in the journal, 1,970 photos and 87 videos in 935 entries, 814 links, 332 files, 307 archived, 193 in
the Trash, over twelve years, in eight vaults.

## How to measure

**Web**, with `npm run dev` and the demo seeded. Scripts in `scripts/perf/` drive a headless Chromium (the one
Playwright keeps in `~/Library/Caches/ms-playwright`) over the DevTools protocol, each in its own browser profile under
`scripts/perf/.profile*` (ignored by git), signing in through `/demo` when it needs to:

| Script | Measures |
|---|---|
| `node scripts/perf/pages.mjs [page]` | Each page: ms until it stops changing, its elements, and a CPU profile by function |
| `node scripts/perf/interact.mjs [step]` | Rail jumps, scrolling, typing in the journal box and in search |
| `node scripts/perf/first-sync.mjs` | A first sign-in from an empty browser until the whole demo has synced |
| `node scripts/perf/edit.mjs` | Ticking a todo: ms from the click to the bubble showing it, six times |
| `node scripts/perf/photo-shift.mjs` | Photos in a browser that has never seen them: whether a tile moves as it loads |
| `node scripts/perf/production.mjs [--warm]` | The production build (`npm run build`, then `npx vite preview --port 5192`): first sync, or a launch with the cards there, and ticking a todo |

The dev server runs React's development build, several times slower than production: compare like with like.

**iPhone** (Simulator, iPhone 17 Pro, Debug build): CPU time used in the first eight seconds after opening a page, and
how long a first sync takes to store every card:

```bash
U=DE9E5672-FBF7-4AA8-BFBE-4F5B1ADADE0A; pid=$(xcrun simctl launch $U dev.notesapp.notes.dev -server http://localhost:5191 -page photos | awk '{print $2}'); for t in 1 2 3 4 5 6 7 8; do sleep 1; ps -o time= -p $pid; done
```

For a first sync, stop the app, take `notes-u-demo.sqlite*` out of its data folder (`xcrun simctl get_app_container $U
dev.notesapp.notes.dev data`, then `Library/Application Support/Notes`), launch it, and count `cards` with `sqlite3`
every half second.

**Mac** (Debug build): the same CPU count after `open -n "Notes Dev.app" --args -server http://localhost:5191 -page
photos`. The app's sandbox folder can't be read from the shell, so a first sync is measured on the iPhone instead.

**Android** (emulator `Medium_Phone_API_35`): measure the **bench** build, `./gradlew installBench
-Pserver=http://localhost:5191` (`Notes Bench`, a release build that isn't debuggable but can be profiled). A debug
build runs most code in the interpreter and is several times slower, so its numbers mislead. Sign it in through the
browser: tap Sign in with Google, press Back to close the picker, tap Sign in with the browser, and approve its code
with `UPDATE device_pairings SET user_id='u-demo' WHERE code='XXXX'`. Time a launch with screenshots
(`adb exec-out screencap`) rather than `uiautomator dump`, which takes a second or two itself. Profile with the NDK's
simpleperf, `python3 $ANDROID_SDK/ndk/<version>/simpleperf/app_profiler.py -p dev.notesapp.notes.bench -r "-e
cpu-clock -f 1000 -g --duration 15"`; the bench build's names are shrunk, so look them up in
`android/app/build/outputs/mapping/bench/mapping.txt`.

## Results

### Web

| What | Before | After | Fix |
|---|---|---|---|
| Opening Photos | 3.05 s, 16,046 elements | 0.10 s, 673 elements | Draws only the tiles near the screen; dates written by a formatter made once (`formatDate`) |
| Opening Links | 0.28 s, 12,430 elements | 0.12 s, 2,608 | Draws 150 at a time, as the journal does (`useShownItems`) |
| Opening Files | 0.31 s, 17,505 elements | 0.19 s, 7,855 | The same |
| Search, typing "coffee beans" | slowest key 75 ms; 37,939 elements after | slowest key 35 ms | Index built once for each change to the cards; 100 results drawn at a time |
| First sync, dev server | 8.5 s | 2.7 s | Pulled pages put away 2,000 cards at a time (`PULL_BATCH`), so the page is drawn 5 times, not 50 |
| First sync, production build | | 3.5 s | |
| Reload, production build | | 1.8 s until the journal shows | |
| Ticking a todo, dev server | 125–213 ms | 88–175 ms | Cards kept in memory and each write put into them, rather than reading all 10,000 back (`DexieStore`) |
| Ticking a todo, dev server, bubbles drawn only when theirs changes | 93–111 ms | 58–93 ms | Bubbles memoized, reading the cards through `useCardsSelect` and `useServices`; the selection object kept; the rail's days kept when the same |
| Ticking a todo, production build | 70–113 ms | 69–107 ms | About 30 ms is the IndexedDB write; about 45 ms is drawing the page around the bubbles (the journal's list, the sidebar's filter counts) |
| Photos tiles moving as they load | moved (laid out as squares) | none of 40 moved | Each photo's size kept in its block (`width`, `height`) |

Already fine, unchanged: the journal reloads in about 1.2 s on the dev server; Calendar, Timeline, Tags, History and
Vaults open in under 0.1 s; Trash, Archive and a tag's journal in 0.2–0.4 s (150 entries drawn); an open entry in 0.3 s;
a jump on the rail settles in under 0.2 s; typing in the journal box takes 17 ms a key.

### iPhone and Mac

| What | Before | After | Fix |
|---|---|---|---|
| iPhone first sync, storing all 10,322 cards | | 3.5 s | Pulled pages put away 2,000 cards at a time; each card parsed once until it changes |
| iPhone Photos, CPU in its first 8 s | 27 s | 2.7 s | Draws only the tiles near the screen |
| Mac Photos, CPU in its first 8 s | | 2.2 s | The same |
| Other pages, CPU in their first 8 s | | iPhone 2.2–3.0 s, Mac 1.5–2.5 s | |
| An empty journal while loading | "Nothing yet" until the cards were read | blank until read | `loaded` |

### Android (bench build unless said)

| What | Before | After | Fix |
|---|---|---|---|
| Photos page | crashed: one box 391,838 px tall | opens, about 3 s of CPU | Drawn in bands of at most 20,000 points, and only tiles near the screen |
| Main thread's share of a first sync (debug) | 56%, mostly the attachment sweep and parsing replies | 10% | Replies parsed and the sweep planned off the main thread |
| Launch with 10,000 cards, CPU | 5–6 s, 28% of it making regular expressions | 4 s | Patterns made once (`DateKey`, `TimeKey`, `Doc`) |
| Launch with 10,000 cards, until the journal shows | 13–15 s by `uiautomator`, about 6–9 s by screenshots | about 8–9 s by screenshots | |
| First sync | | about 21 s of CPU (debug: 41 s, over a minute) | Pages put away 2,000 at a time; each card parsed once |
| An empty journal while loading | "Nothing yet" for several seconds | blank until read | `loaded` |

## Still slow

- **Web: an edit still takes 70–110 ms in production.** Bubbles are no longer drawn again (2026-11-26), but the journal
  page around them is (`Stream`, the sidebar's `FilterPanel` counts), and the save waits about 30 ms on IndexedDB.
- **Android: launching with 10,000 cards takes 8–9 s** before the journal shows, with about 4 s of CPU: every card's
  payload is parsed at launch, and what it waits on for the rest isn't known yet.
- **Not yet measured:** ticking a todo or typing on the Mac, iPhone and Android; scrolling the journal for a long time
  on each.
