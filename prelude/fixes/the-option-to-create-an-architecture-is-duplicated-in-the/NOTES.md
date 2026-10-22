# The architecture offered twice in New design

## Problem

New design's Kind listed "The project’s architecture" twice, worded
differently, on a project with no architecture.

## Cause

Two fixes, made on separate branches the same day, each added the choice to
`server/views/projects/_new-design.eta`:

- "After the most recent change, should I be able to create an…" (PR #42)
- "I added support for a project's architecture view…"

They added different lines in the same place, so git merged them without a
conflict and both stayed. This wasn't old code: main has the duplicate too.
The tests only checked that `value="architecture"` appeared, so they still
passed with two.

The same merge left an empty `## Open questions` heading in
prelude/project-landing-page/NOTES.md.

## Change

- `_new-design.eta`: removed the second radio and kept "drafted from the
  code; every agent reads it before it changes anything", which matches the
  modal's own intro for `?kind=architecture`.
- `test/system.test.js`: checks that the architecture is offered exactly once.
- prelude/project-landing-page/NOTES.md: removed the stray heading and added
  a note about this fix.

## Review of the two merged fixes

Everything else they touched merged cleanly: the Reference card, R-x4b and
R-wm3, the `/system` and `/architecture` routes in `server/main.js`, and the
architecture surface. One small thing was left alone: the comment above New
design's route (`server/main.js`, "?kind= picks the design system or the
shell") doesn't mention the architecture.

## To check

- Run `node --test test/system.test.js test/system-page.test.js`, then `npm test`.
- New design on a project with no architecture shows one "The project’s
  architecture" choice.
- Project Landing Page's `new-project` New design modal should differ from
  its approved screen only by losing the second choice.
