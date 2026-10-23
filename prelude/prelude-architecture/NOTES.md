# Prelude Architecture - notes

Prelude's own architecture, as markdown in `architecture/`, read by every design, build and fix agent and shown on the project's Architecture page. Drafted from the code on 2026-10-22 (CLAUDE.md, docs/plan.md, the imports in `server/`, `tools/`, `start.js`).

## Decisions

- **Eight layers**: Windows, Entry points, Pages, Agent and live state, Designs and hosting, Project files, Shared helpers, Outside. Chosen so every import today goes sideways or down; `home.js` and `turns.js` use each other's module, so page models, turns and views share the Pages layer.
- **Parts follow responsibilities, not one per file**: e.g. `host` holds host.js, hosts.js, renderers.js and events.js; `designs` holds designs, fixes, app-config and snapshots. The sandboxed `renderer` is its own process part.
- **Running the built app is its own part, `runs`**, not the design host's (the person, 2026-10-22): the host renders designs, runs starts the real app.
- **Tests aren't a part**: the check only expects files in folders a part names, so `test/` stays out.
- **Decisions come from the plan's ground rules and "Decisions made"**; seven so far. The undated ones (D-r7s, D-b9k) are dated 2026-10-15, as the person asked.

- **Word helpers move to `server/words.js`** (D-w4n, proposed; the person agreed 2026-10-22): `ago`, `plain`, `sentences`, `clip` from home.js and `whenWords`, `startedWords`, `sinceWords` from workspace.js, in a new lowest layer, Shared helpers. The `words` part and the `uses` are written as the target. The code moves in a fix or build session, so until then the check reports `server/words.js` missing and architecture's import of home.js.

- **The agent follows the app's own Koda; Prelude installs only in a fix's worktree** (D-k7v, proposed 2026-10-23). `designs` finds the app's Koda (worktree, then checkout, then Prelude's, since a fresh worktree has no `node_modules`). `pages` compares versions, and a new `installs` part (`server/installs.js`) runs the package manager, fenced to worktrees, with a fixed command. Flow: `koda-upgrade`. Until it's built, the check reports `server/installs.js` missing.
- **Installs handle only `@kodalang/core`** (the person, 2026-10-23): no other package, so the agent can't steer what gets installed.
- **An install runs only after the person approves its command** (the person, 2026-10-23), scripts included, as with a host: install scripts are outside code.

## Open questions

- Should the design host serve the app's Koda runtime to designs instead of Prelude's (`/koda/` in main.js)?
- After merging an upgrade, should Prelude offer to install in the person's checkout, or leave that to them?
