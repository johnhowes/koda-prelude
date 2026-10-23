# The agent follows the app's own Koda, and Prelude installs it only in a worktree
status: proposed
date: 2026-10-23
parts: designs, pages, installs, server, agent, host, branches

## Context
Every prompt points the agent at Prelude's own installed Koda (`server/main.js` resolves `@kodalang/core`), so an app on another version gets guidance for attributes it doesn't have. Upgrading an app's Koda needs `npm install`, which the agent can't run and nothing in Prelude does. A fresh worktree has no `node_modules` at all, since it's ignored.

## Decision
`designs` finds the app's Koda and reads its version from `node_modules/@kodalang/core/package.json`: first in the worktree (the app's path from `prelude.json`, then the root), then the same in the project's own checkout, and Prelude's only when neither has one. The server passes that path to every prompt as `kodaPath` and to `--add-dir`, and the design host serves that Koda's runtime to a design's pages (`/_prelude/koda/`), so designs behave as the app will; Prelude's own pages keep Prelude's. `pages` compares the app's version with Prelude's on the project page and offers an upgrade, which starts a fix. A new part, `installs`, runs the project's package manager (chosen by its lockfile) in that fix's worktree: only in a worktree `branches` made, never the person's checkout, with a fixed command Prelude builds (never one the agent wrote), a time limit, and only `@kodalang/core` by name: it installs no other package. Install scripts are code from outside the project, so the install runs only after the person approves it, seeing the command first, as with a host.

## Consequences
The agent reads the docs and skills of the Koda the app will run, and an upgrade's turn reads the new version's. Installing is the one place Prelude runs a package manager, so its fence lives in one file. The person's checkout keeps its old `node_modules` until they install after merging.
