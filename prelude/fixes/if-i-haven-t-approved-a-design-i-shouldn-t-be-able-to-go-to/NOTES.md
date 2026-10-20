# Fix: If I haven't approved a design I shouldn't be able to go to…

What's wrong, the cause, what changed, and what to check - written as the fix goes.

## The problem

A design that isn't approved shouldn't be able to start a build session, and
the app should say it needs approving, so it's clear why there's no build.
The case the person hit: a design approved once, then changed. The project
page still said it was "Ready to build" ("N pages, all approved"), and its
Build page offered Start a build session, with nothing about the change.

## The cause

The app counted a design as approved once its `snapshots/` folder held any
screens, whenever they were approved: `progressOf` (`server/project.js`), the
"ready to build" need (`server/home.js`), the Build page's `buildView()` and
the refusal in `POST …/builds` (`server/main.js`). Only the design page knew
the difference: its review strip and header stage read the last check
(`reviewOf`, `server/workspace.js`), which lists pages that differ from the
approved screens.

## The change

- `server/workspace.js`: `changedSinceApproved(dir)`. True when the design
  has approved screens and the last check after that approval, in the
  design's own sessions, found pages that differ. `reviewOf` now reads the same
  last check, so it skips build sessions too. Their check is the build's (the
  app's port differing), as the review strip's comment already said.
- Project page: such a design isn't approved (`approved: 0`, stage designing,
  no Ready to build pill). Its line says "N pages, changed since approved"
  (`projects/_designs.eta`). Needs you's "ready to build" leaves it out too.
- Build page: `approved` is false and `changed` is true. A notice "The design
  changed since you approved it." offers Show what changed (the design's page)
  and Approve again. Start a build session hides. Starting one anyway is
  refused with the same reason.
- Designs: prelude/build has a new rule R-q3d and a new state, changed since
  approved. In prelude/project-landing-page, R-r6b now covers it and Large
  project's Save and resume shows it. Each design's NOTES.md says so, and
  prelude/design-workspace's notes say the review strip skips build sessions.
- Tests: `test/approved.test.js` is new. `test/increment.test.js` approved its
  redesign by writing a screen into an existing folder, which left the
  approval older than the design session's check. Now it waits for that turn
  to end and marks the approval as now, as Approve does.

## What to check

- Run `npm test` (or just `node --test test/approved.test.js`; also
  `test/build.test.js` and `test/app.test.js`, which cover Build and the
  project page).
- Approve a design, change a page in a design session, then look at the
  project page. It shouldn't say Ready to build, and its line should say
  "changed since approved". Its Build page should show the "changed since you
  approved it" notice and no Start a build session. Approve again there, or on
  the design's page, and both come back.
- Build's new state (changed since approved) and Large project's Designs list
  are new screens to look at and approve.
- A design whose build session found its port differing shouldn't now show
  "The design changed since you approved it" on its design page. That's a
  deliberate change.
