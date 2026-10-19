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

Waiting on the person's decision of what's important (asked in the chat,
2026-10-19). Nothing changed yet.
