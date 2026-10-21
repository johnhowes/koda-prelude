# My "Prelude Shell" design was showing up as not designed

## The problem

On the project page, the Prelude Shell read "nothing designed yet", even
though every page renders in its layouts. Opened and approved, it moved to In
progress, with nothing to do there.

## The cause

`progressOf()` in `server/project.js` counts a shell by its own pages (not its
gallery) and its layouts, and `shellLayouts()` in `server/host.js` lists only
`layouts/<name>.eta` files. Prelude Shell's routes are all `gallery/…`, and
its layouts are the app's own files, linked in `layouts.json` (`app`,
`window`); `layouts/` holds only partials and sample data. So it counted 0
layouts and 0 pages: "nothing designed yet", stage `designing`. Home's In
progress line (`whereOf()` in `server/home.js`) had the same blind spot:
"Being designed".

In progress is separate: opening the design to approve it made its branch,
`prelude/prelude-shell`, and the approved screens are on it. A design with a
branch is listed under In progress until that branch is finished.

## The change

- `server/host.js`: `allShellLayouts()`, the shell's own layouts and those
  linked in `layouts.json`.
- `server/project.js`: `progressOf()` counts layouts with it. Linked ones are
  already built (`unbuiltLayouts()` is unchanged), so Prelude Shell reads
  "2 layouts, all built", stage `built`.
- `server/home.js`: a shell's In progress line counts its layouts beside its
  pages: "2 layouts, approved" rather than "Being designed".
- `prelude/project-landing-page/NOTES.md`: a line on it. No views or states
  changed; the design already showed a shell like this (typical's Spark Shell).

## Tests

`test/host.test.js`: "the shell's layouts are its own and those linked to the
app's files; only the linked are built". Run `npm test` (or
`node --test test/host.test.js test/app.test.js`).

## What to check

- On the project page, once `prelude/prelude-shell` is finished (under In
  progress), the Prelude Shell is under Designs as "2 layouts, all built", and
  the Built filter shows it.
- Until then, home's In progress line for it says "2 layouts, approved".
- Finishing that branch brings its approved screens into main; discard it
  instead if you don't want them.
