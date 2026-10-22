# Words for times and text live in a shared helper, not in a page model
status: proposed
date: 2026-10-22
parts: words, architecture, pages

## Context
The architecture check imports `home.js`, the Home page's model, only for `ago` ("2 minutes ago"). The project page imports `ago`, `plain`, `sentences` and `clip` from it too, and `workspace.js` holds `whenWords`, `startedWords` and `sinceWords`, used by the Build page, the check and turns. Small helpers kept in page models make other parts depend on pages they have nothing to do with.

## Decision
Move these helpers into `server/words.js`, a module with no imports of its own in the lowest layer, Shared helpers. Every part may use it, and the architecture check no longer uses the page models.

## Consequences
`architecture.js` stops importing `home.js`, so the checker no longer depends on any page. Until the code moves, the check reports `server/words.js` as missing and the import of `home.js` as a use the architecture part doesn't make.
