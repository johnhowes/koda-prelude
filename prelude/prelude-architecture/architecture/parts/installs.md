# Installs
layer: Designs and hosting
kind: module
short: Package installs in a worktree
files: server/installs.js
uses: branches, designs

Runs the project's package manager in a fix's worktree, so the worktree has the packages its `package.json` asks for. It's the only part that installs packages, and it builds every command itself: the agent can't run commands, and nothing it writes becomes one.

## Responsible for
- Choosing npm, pnpm or yarn by the app folder's lockfile
- `install @kodalang/core@<version>` for an upgrade, and no other package
- The fence: only in a worktree `branches` made, only once the person approves the command (scripts and all), a time limit, output kept for the chat

## Not its job
- Deciding when to upgrade (pages, server) or which Koda the agent reads (designs)
- Installing in the person's own checkout, or for the app runs start

## Owns
- The install's process, and `node_modules` in the worktree
