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
build runs most code in the interpreter and is several times slower, so its numbers mislead. Sign it in with Use the
demo account on its sign-in screen (with `adb reverse tcp:5191 tcp:5191`). Time a launch with screenshots
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
| Mac scrolling the journal, main thread busy over 8 s of scrolling (`sample <pid> 8 1`) | 922 samples, 683 of them the rail working out its marks again each frame | 574, none of them the rail (about 300 of those were the measuring tool's accessibility reads) | The rail's marks kept until its days or height change (`RailMarks`) |
| iPhone launch, every card read and indexed (Debug build, Simulator) | | 1.4–1.7 s after the process starts, 0.9 s of it reading the cards | Fast enough that showing the newest first, as Android does, would save under a second: not done |

### Android (bench build unless said)

| What | Before | After | Fix |
|---|---|---|---|
| Photos page | crashed: one box 391,838 px tall | opens, about 3 s of CPU | Drawn in bands of at most 20,000 points, and only tiles near the screen |
| Main thread's share of a first sync (debug) | 56%, mostly the attachment sweep and parsing replies | 10% | Replies parsed and the sweep planned off the main thread |
| Launch with 10,000 cards, CPU | 5–6 s, 28% of it making regular expressions | 4 s | Patterns made once (`DateKey`, `TimeKey`, `Doc`) |
| Launch with 10,000 cards, until the journal shows | 7.0–8.3 s (one 12 s), timed by screenshots 0.4 s apart | 6.0–7.6 s | Cards read on every core at once when there are many (`allCards`) |
| Launch, until entries show, by Android's own count (`reportFullyDrawn`, "Fully drawn" in `adb logcat`) | | 3.4–4.0 s fresh from install; 1.7–2.1 s once Android has compiled the app | The newest 300 entries and the tags read first, by an index on `updated_at` and the tags' IDs kept from the last launch, and shown while the rest is read (`AppModel.preview`); one refresh at a time, where two ran together and read every card twice |
| Launch, until the first frame ("Displayed") | | 2.3–3.0 s fresh; 1.3–1.5 s compiled | Starting the app: mostly how much of it Android has compiled ahead of time, which a store install gets at once and a downloaded APK in time |
| First sync | | about 21 s of CPU (debug: 41 s, over a minute) | Pages put away 2,000 at a time; each card parsed once |
| An empty journal while loading | "Nothing yet" for several seconds | blank until read | `loaded` |

## Still slow

- **Web: an edit still takes 70–110 ms in production.** Bubbles are no longer drawn again (2026-11-26), but the journal
  page around them is (`Stream`, the sidebar's `FilterPanel` counts), and the save waits about 30 ms on IndexedDB.
- **Android: the first frame takes 1.3–3 s,** most of it the app starting before Android has compiled it. A baseline
  profile of our own launch (made with a Macrobenchmark module) would compile it at install. Reading every card still
  takes about 3 s more after the first entries show; meanwhile a search, a filter, the board and the pages that need
  every card say "Loading your notes…"
- **Checked by hand after the bubbles' change (2026-11-26):** a tag renamed on another device shows under every bubble
  within 90 ms, as does a linked entry's new title; picking, Escape and a bubble's menu work.
- **Not yet measured:** ticking a todo or typing on the Mac, iPhone and Android; scrolling the journal for a long time
  on each.
