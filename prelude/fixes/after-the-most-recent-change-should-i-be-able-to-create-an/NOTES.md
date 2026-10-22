# Creating an architecture from the project page

## Problem

After the Reference card arrived, there was no way from a project's page to
create its architecture.

## Cause

- The Reference card (`server/views/projects/_reference.eta`) showed a row
  only once it had something in it (R-x4b as it was), so a project without an
  architecture never linked to `/f/<id>/architecture`, the page that offers
  "Draft it from the code…". With no design system components either, the
  whole card was hidden.
- New design (`server/views/projects/_new-design.eta`) offered only the
  design system and app shell as kinds; the architecture kind came only from
  `?kind=architecture`, which only the Architecture page links to.

## Change (the person's decision)

- The Reference card always shows, with both rows. Design system: `/system`
  with components; its design when made but empty; New design with
  `?kind=system` when not made. Architecture: always `/architecture`, saying
  "Nothing written yet · draft it from the code" until it has parts.
- New design's Kind offers "The project’s architecture" until the project
  has one (R-wm3).
- Project Landing Page: RULES.md (R-x4b, R-wm3) and NOTES.md updated.
- Tests: `test/system.test.js` checks the card's rows before and after a
  design system exists, and the architecture kind in New design.

## To check

- Run `node --test test/system.test.js` (and the whole suite, `npm test`).
- On a project with no architecture: the Reference card shows Architecture,
  "Nothing written yet", and it opens the Architecture page's "Draft it from
  the code…".
- New design shows "The project’s architecture" as a kind; making one opens
  its design, and the kind is gone from New design afterwards.
- On a project with no design system: its row opens New design with the
  design system picked.
