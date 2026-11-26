# Working on this project

Read by every coding agent working here (Claude Code through `CLAUDE.md`, Antigravity, Gemini, Codex and others), so
they all work the same way. How to run things is in README.md; the plan and what's been decided in PLAN.md; how each
native app compares with the web app in PARITY.md; speed in PERFORMANCE.md.

This file is public, as the repository is. Anything about the owner, their accounts or this computer (local test
PINs, paths, tools, account details) goes in `.agents/rules/private.md` instead, which git ignores: Antigravity reads
it from `.agents/rules/`, and Claude Code through `CLAUDE.local.md`. Read it too when it's there, and add a lasting
rule to whichever of the two it belongs in, never to an agent's own private memory, which the others can't read.

## What the project is

A notes and todos app: a web app (React, Vite) on a Cloudflare Worker (Hono, D1), which is the standard, and native
apps that match it in behavior and design, not just features: SwiftUI for Mac, iPhone and iPad (`apple/`, iOS and
macOS 26) and Kotlin with Jetpack Compose for Android (`android/`). Windows and Linux use the web app. Don't propose
Tauri, Capacitor, React Native or a PWA instead. Native apps sync with the same server and must round-trip a card's
TipTap JSON without losing fields they don't know.

## How to work

- **Build, don't ask.** Don't stop for product questions: pick a sensible default, note it in PLAN.md, and say what was
  chosen at the end. Ask only when truly blocked.
- **Work on `main`.** No feature branches unless asked.
- **Finish every task unasked:** small commits, one idea each, each one typechecking, passing its tests and building.
  Update README.md and PLAN.md in the same commit as what they describe, and PARITY.md with every feature or behavior
  change, web or native (a web change rewrites its row; a native change updates that app's cell). Fold a fix to an
  unpushed commit into that commit. End with a list of the commits: hash, title, and a line on what each changes.
- **Never push, deploy, apply remote migrations or change Google or Cloudflare settings until the user says so.** A
  push to `main` deploys (Cloudflare Workers Builds) and applies new D1 migrations. "Push" covers only the commits that
  exist when it's said, never later ones, not even a fix for what was just pushed.
- **Verify before claiming.** Before saying what's done or missing, read the web code, the native code and the
  PARITY.md rows together, and try it. A ✅ marked C (checked in code) isn't proof; correct a row found wrong. Mark T
  only once tried.
- **Test against the demo, not mock-ups.** `npm run demo` seeds an account with an example of every feature in every
  place it shows, plus about 10,000 entries over twelve years for scale (`scripts/demoData.ts`,
  `scripts/demoHistory.ts`). A new or changed feature adds its cases to the seed (IDs start `demo-`) in the same
  piece of work. Never add cards to the demo account by hand outside the seed.
- **Speed:** results live in PERFORMANCE.md with how they were measured (`scripts/perf/`). Read it before measuring,
  and update it rather than measuring from scratch. Measure Android with the bench build, never the debug one.

## Handing over work in progress

More than one agent works here (Claude Code and Antigravity), and neither can see the other's conversation: only what's
in files. Finished work is in the code, the commits and the docs above; what's still in progress goes in
`.agents/rules/handoff.md`, which git ignores and both agents load at the start (Antigravity from `.agents/rules/`,
Claude Code through `CLAUDE.local.md`).

- **Before stopping with work unfinished** (the owner switches agents, a session ends or runs out of room), write in
  it: what's being done and why, what's done so far and where (files, uncommitted changes), what's next, and what was
  tried and didn't work. Name what the owner decided in the conversation that isn't written anywhere else.
- **On starting,** read it, and say what it says before picking the work up.
- **Once that work is committed,** take it out, leaving only what's still open (or "Nothing in progress"). Anything
  lasting from it moves to its proper place: a decision to PLAN.md, a rule to AGENTS.md or `private.md`.

## Safety

- Never handle credentials or secrets: don't create, enter or paste API tokens, passwords or keys, even if asked. The
  demo's PIN, 1234, is a test value.
- Don't sign in on Google's real sign-in page; use the demo sign-in (`/demo`, or Use the demo account in a native dev
  build).
- Back up the local D1 before `npm run demo`: copy `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` somewhere
  outside the repo. The seed keeps everything but `demo-` cards; never make it delete whole accounts or vaults, and
  ask before it removes anything else, since the user's own test data shares that account.
- Revert test edits to the demo data when done.
- Don't add password-type or `-webkit-text-security` fields: typing in one makes Chrome hold macOS Secure Input, which
  can stop mouse tools scrolling in every app. Use drawn dots, as `PinInput` does.

## Setup notes

- **Dev servers** run in tmux, so they outlive any agent's shell: session `notes-app`, window `api` (`npm run dev:api`,
  port 8788) and window `web` (`npm run dev`, port 5191). Check `tmux ls` before starting new ones (README.md has the
  command).
- **Apple:** run `xcodegen` in `apple/` first (the project isn't committed). Builds need `-allowProvisioningUpdates`
  and sign with the team in `project.yml`. The Mac release is ad hoc signed (`.github/workflows/mac-release.yml`). A Debug
  build is a separate app, "Notes Dev" (`dev.notesapp.notes.dev`, scheme `notesapp-dev://`). Launch it with
  `-server http://localhost:5191` (Vite, which serves the demo's photos and files; on 8788 they go missing).
- **Quit Notes Dev before rebuilding the Mac app** (`pkill -f "Debug/Notes Dev.app/Contents/MacOS/Notes Dev"`), then
  open the new build: a running copy crashes when its dylib is rewritten, or keeps running old code. A rebuild doesn't
  change the files' dates; compare `dwarfdump --uuid` to tell builds apart.
- **Android:** Gradle through `./gradlew` only. `adb reverse tcp:5191 tcp:5191` before pointing it at the dev
  server. On the emulator `input swipe` lands as taps; drag with `input motionevent` sequences.
- **Temporary files** go in a scratch folder outside the repo, not in the repo or `/tmp` unless asked.
