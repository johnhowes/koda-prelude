# Fix: The needs you lists

What's wrong, the cause, what changed, and what to check - written as the fix goes.

## The problem

Needs you on Home (prelude/landing-page) and on a project's page
(prelude/project-landing-page) lists so many things that it's noise.

## The cause

Both lists, and the bar's count, are one reading: `needsOfWork()` in
`server/home.js` (Home through `homeOf()`, a project's page through
`needsOfProject()`). What makes it long:

- **A "Turn finished" row for every session of the last week**, in every
  design and fix, whose last turn the person hasn't opened - not one per
  design, so sessions a newer one has replaced still show. A turn counts as
  seen only if its session's page was opened, or was listening as it ended;
  leaving while the agent works leaves a row.
- **"Ready to build" and "Pull request open" repeat the page**: Designs'
  Ready to build pill (R-r6b) and In progress's pills on the project page,
  and each card's In progress line on Home. Neither expires.
- **Nothing caps a design**: one design can hold a pull request, pages to
  build and several finished turns at once.

## The change

The person chose (2026-10-19): Needs you holds only what they must act on -
the agent asking, a stopped build, a turn that ended with an error.

- `server/home.js`: `needsOfWork()` still reads every kind, since each
  design's In progress line on Home says "Pull request open", "3 pages to
  build" or "Turn finished" from them. A new `needsYou()` keeps only the
  three that need acting on, for `homeOf()` (Home's list, each card's
  "N waiting on you", the bar's count) and `needsOfProject()` (the project's
  page). A finished need carries `failed`.
- `server/views/home/_needs-you.eta`: the empty list no longer promises
  "a design is ready to build".
- Designs: landing-page's RULES (R-n4v, R-8hc, R-w2k), NOTES and typical
  state; project-landing-page's NOTES and its typical, update clashed and
  large project states.
- `test/home.test.js`: a turn that finished well isn't listed; one with an
  error is until opened, and leaves after a week; the question test orders
  against an error and counts 2 on the card.

## What to check

- Run `node --test test/home.test.js` (and the whole suite, `node --test`).
- Home, typical: three rows (Asking you, Build stopped, Document upload's
  error); the bar says 3. The project cards' In progress lines still say
  "Pull request open" and "3 pages to build".
- Project page: typical shows only Rate lock's stopped build; update clashed
  has no Needs you card; large project shows three rows; Designs still
  shows Ready to build, In progress still Pull request open.
- In the app, with real projects: the list should be short, and an opened
  failed turn should leave it.
