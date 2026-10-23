# Installs
layer: Designs and hosting
kind: module
short: Installs the app's Koda
files: server/installs.js
uses: branches, designs

Runs the project's package manager to install the app's Koda: in a fix's worktree for an upgrade, and in the person's checkout once the upgrade is merged. It's the only part that installs packages, and it builds every command itself: the agent can't run commands, and nothing it writes becomes one.

## Responsible for
- Choosing npm, pnpm or yarn by the app folder's lockfile
- `install @kodalang/core@<version>`, and no other package
- The fence: only in a worktree `branches` made or the project's own folder, only once the person approves the command (scripts and all), a time limit, output kept for the chat

## Not its job
- Deciding when to install (pages, server) or which Koda the agent reads (designs)
- Changing anything in the checkout but `node_modules` (the lockfile changes only in the fix)

## Owns
- The install's process
