# Prelude Architecture - notes

Prelude's own architecture, as markdown in `architecture/`, read by every design, build and fix agent and shown on the project's Architecture page. Drafted from the code on 2026-10-22 (CLAUDE.md, docs/plan.md, the imports in `server/`, `tools/`, `start.js`).

## Decisions

- **Seven layers**: Windows, Entry points, Pages, Agent and live state, Designs and hosting, Project files, Outside. Chosen so every import today goes sideways or down; `home.js` and `turns.js` use each other's module, so page models, turns and views share the Pages layer.
- **Parts follow responsibilities, not one per file**: e.g. `host` holds host.js, hosts.js, renderers.js, events.js and runs.js; `designs` holds designs, fixes, app-config and snapshots. The sandboxed `renderer` is its own process part.
- **Tests aren't a part**: the check only expects files in folders a part names, so `test/` stays out.
- **Decisions come from the plan's ground rules and "Decisions made"**; seven so far.

## Open questions

- Dates of D-r7s (sandboxed renderer, put at 2026-10-15) and D-b9k (branches, 2026-10-17) are estimates; the plan doesn't date them.
- `architecture.js` imports `home.js` only for `ago`; worth moving that helper lower so the checker sits below the page models?
- Should `runs.js` (running the built app) be its own part rather than part of the host?
