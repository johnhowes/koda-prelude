# The agent follows the app's own Koda, and Prelude installs it only with the person's approval
status: proposed
date: 2026-10-23
parts: designs, pages, installs, server, agent, host, branches

## Context
Every prompt points the agent at Prelude's own installed Koda (`server/main.js` resolves `@kodalang/core`), so an app on another version gets guidance for attributes it doesn't have. Upgrading an app's Koda needs `npm install`, which the agent can't run and nothing in Prelude does. `node_modules` isn't in git, so a fresh worktree has none, and merging an upgrade leaves the old Koda installed in the person's checkout.

## Decision
`designs` finds the app's Koda and reads its version from `node_modules/@kodalang/core/package.json`: first in the worktree (the app's path from `prelude.json`, then the root), then the same in the project's own checkout, and Prelude's only when neither has one. It also reads the version the app's `package.json` asks for. The server passes the Koda it found to every prompt as `kodaPath` and to `--add-dir`, and the design host serves its runtime to a design's pages (`/_prelude/koda/`), so designs behave as the app will; Prelude's own pages keep Prelude's.

`pages` compares the app's version with Prelude's on the project page and offers an upgrade, which starts a fix. A new part, `installs`, runs the project's package manager (chosen by its lockfile) in two places: in that fix's worktree, installing Prelude's version, and in the person's checkout once the upgrade is merged, installing the version `package.json` asks for. `pages` offers that second install when the checkout's installed Koda isn't the one it asks for. Either way the command is fixed (never one the agent wrote), names only `@kodalang/core`, has a time limit, and runs only after the person approves it, seeing it first, as with a host: install scripts are code from outside the project.

## Consequences
The agent, the designs and the app all use the Koda the app declares, and an upgrade's turn reads the new version's docs. Installing is the one place Prelude runs a package manager, so its fence lives in one file. It's also the one place Prelude changes the person's checkout, and only in `node_modules`, only after asking.
