# Prelude Architecture - notes

Prelude's own architecture, as markdown in `architecture/`, read by every design, build and fix agent and shown on the project's Architecture page. Drafted from the code on 2026-10-22 (CLAUDE.md, docs/plan.md, the imports in `server/`, `tools/`, `start.js`).

## Decisions

- **Eight layers**: Windows, Entry points, Pages, Agent and live state, Designs and hosting, Project files, Shared helpers, Outside. Chosen so every import today goes sideways or down; `home.js` and `turns.js` use each other's module, so page models, turns and views share the Pages layer.
- **Parts follow responsibilities, not one per file**: e.g. `host` holds host.js, hosts.js, renderers.js and events.js; `designs` holds designs, fixes, app-config and snapshots. The sandboxed `renderer` is its own process part.
- **Running the built app is its own part, `runs`**, not the design host's (the person, 2026-10-22): the host renders designs, runs starts the real app.
- **Tests aren't a part**: the check only expects files in folders a part names, so `test/` stays out.
- **Decisions come from the plan's ground rules and "Decisions made"**; seven so far. The undated ones (D-r7s, D-b9k) are dated 2026-10-15, as the person asked.

- **Word helpers move to `server/words.js`** (D-w4n, proposed; the person agreed 2026-10-22): `ago`, `plain`, `sentences`, `clip` from home.js and `whenWords`, `startedWords`, `sinceWords` from workspace.js, in a new lowest layer, Shared helpers. The `words` part and the `uses` are written as the target. The code moves in a fix or build session, so until then the check reports `server/words.js` missing and architecture's import of home.js.

- **The agent follows the app's own Koda** (D-k7v, proposed 2026-10-23). `designs` finds the app's Koda (worktree, then checkout, then Prelude's, since a fresh worktree has no `node_modules`). `pages` compares versions, and a new `installs` part (`server/installs.js`) runs the package manager with a fixed command. Flow: `koda-upgrade`. Built 2026-10-23 in the fix "server/installs.js, in Installs, doesn't match the…": `server/installs.js`, `kodaOf`/`findKoda` in `server/app-config.js`, `kodaFor` in `server/main.js` (prompts and the design host), and the project page's offers (`kodaModelOf` in `server/project.js`). Clicking an offer is the approval, since the button shows the command, as with Run (R-h2w).
- **After an upgrade merges, Prelude offers to install it in the person's checkout** (the person, 2026-10-23), since `node_modules` isn't in git and the checkout keeps the old Koda otherwise. `pages` offers it when the installed version isn't the one `package.json` asks for; it's the one place Prelude changes the checkout, and only `node_modules`.
- **Installs handle only `@kodalang/core`** (the person, 2026-10-23): no other package, so the agent can't steer what gets installed.
- **An install runs only after the person approves its command** (the person, 2026-10-23), scripts included, as with a host: install scripts are outside code.
- **The design host serves a design the app's Koda runtime** (the person, 2026-10-23), found the same way as the agent's, so designs behave as the app will. Prelude's own pages keep Prelude's Koda.
- **Visuals in the chat are fenced blocks in a versioned vocabulary** (D-v3x, proposed; the person agreed 2026-10-23). The tags are `prelude-flow-1` and `prelude-map-1`. The version goes in the tag because Koda's fence regex allows only `[A-Za-z0-9_-]` and nothing after it. Blocks come out before `renderMarkdown`, since it has no hook. The new `visuals` part (Shared helpers, `server/visuals.js`) is a registry of kinds, so a new visual is one entry plus a `_visual-<kind>.eta` partial. Blocks are parsed and checked when shown, against the branch's parts, and a failed one stays a code block without telling the agent. The automatic map of changed parts is recorded at save time. Flow: `visual`. Until it's built, the check reports `server/visuals.js` missing.
- **Every prompt gets the vocabulary** (design, build, fix and ask; the person, 2026-10-23) once there's an architecture. Ask also gets a read-only architecture brief.

## Open questions

- None right now.
