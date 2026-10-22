# Prelude Architecture - notes

Prelude's own architecture, as markdown in `architecture/`, read by every design, build and fix agent and shown on the project's Architecture page. Drafted from the code on 2026-10-22 (CLAUDE.md, docs/plan.md, the imports in `server/`, `tools/`, `start.js`).

## Decisions

- **Seven layers**: Windows, Entry points, Pages, Agent and live state, Designs and hosting, Project files, Outside. Chosen so every import today goes sideways or down; `home.js` and `turns.js` use each other's module, so page models, turns and views share the Pages layer.
- **Parts follow responsibilities, not one per file**: e.g. `host` holds host.js, hosts.js, renderers.js and events.js; `designs` holds designs, fixes, app-config and snapshots. The sandboxed `renderer` is its own process part.
- **Running the built app is its own part, `runs`**, not the design host's (the person, 2026-10-22): the host renders designs, runs starts the real app.
- **Tests aren't a part**: the check only expects files in folders a part names, so `test/` stays out.
- **Decisions come from the plan's ground rules and "Decisions made"**; seven so far. The undated ones (D-r7s, D-b9k) are dated 2026-10-15, as the person asked.

## Open questions

- `architecture.js` (the checker) imports `home.js` (Home's page model) only for its `ago` time helper. A small shared helper module in a lower layer would free the checker from depending on a page model. Asked the person; not yet decided.
