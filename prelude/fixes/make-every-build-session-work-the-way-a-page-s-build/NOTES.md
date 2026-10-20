# Fix: Make every build session work the way a page's build…

What's wrong, the cause, what changed, and what to check - written as the fix goes.

## The problem

Only a page's build session opened in Build (`build/session`). The app
build and the shell's layouts build still opened on the design page, so the
design page kept parts only builds use: the chat's "This session builds …"
notice, a "Next:" transcript entry after each build turn, the Build pill
and build sessions in the sessions menu (and so a design's latest session,
R-o4s, could be a build), and the Design | App switch with App mode.

## The cause

`isPageBuild` (`server/main.js`) left out `APP_GROUP` and `LAYOUTS_GROUP`,
since those have no screens for the check, so the session route sent them
to the design page. `afterBranchTurn` wrote the `next` entry; `pageModel`
listed every session with `build: true`; `surfaceOf` and the design bar
carried `mode` and `app`.

## The change

Designed in `prelude/build` (views, routes, three new states, NOTES.md's
Decisions and "What moved from the design page, and why"), and built:

- Every build session opens in Build (`buildKind`: page, app, layouts).
  The app and layouts builds show "The build" beside the chat
  (`build/_result`): whether the app starts from the branch, the shell's
  layouts, and the files the build changed since the session started.
- Prelude's existing start after each build turn is the "starts" check
  (`startApp`, kept in `sessions/<id>/result.json`), as agreed; no separate
  probe. The app can be approved from the build session ("Approve and start
  the app"); the transcript note says so instead of pointing at the design
  bar. An app that doesn't start shows what it printed, and Ask the agent to
  fix it sends that to the agent.
- What's next is the session page's (`build/_next`), above the check or
  the result; the transcript's "Next:" entry is gone (`afterBranchTurn`,
  `_entry`). `builtNow` is shared by the two.
- Build lists the design's build sessions; the design page's menu, its
  latest session, "Carry on from…" and the page under an overlay are design
  sessions only. A build session's chat lists only build sessions, without
  New session.
- The design page has no Design | App switch or App mode (`_design-bar`,
  `_surface`, `_keep`, `_frame`, capture, `surfaceOf`).
- `prelude/design-workspace` isn't changed, as asked: its states still
  carry a build session and App mode, which the app now doesn't show, so
  its pages will differ from their approved screens where they showed them.

## What to check

- Run `node --test test/build.test.js test/app.test.js test/hosts.test.js`,
  then the whole suite (`npm test`).
- Build's new states: App build (Approve and start the app, in the notice
  and the toolbar), App doesn't start (the danger notice, what it printed),
  Layouts built (both layouts Built, Finish on the project page), and the
  Build page's "Build sessions" list in every state.
- In a real project: build the app from the project page; its session
  should open in Build, ask to approve the app after the first turn, and
  say whether it starts after each turn after that.
- The design page: no Design | App, no Build pill or build sessions in the
  menu, no "This session builds …", no "Next:" in an old build's transcript.
- Prelude will show the Design Workspace's and Build's pages that differ
  from their approved screens; that's on purpose. The Design Workspace's
  notes and states are for its own session to tidy (Build's NOTES.md has a
  paragraph to paste).
