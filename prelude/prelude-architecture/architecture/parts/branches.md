# Branches
layer: Designs and hosting
kind: module
short: A branch and worktree per design
files: server/branches.js
uses: folders, sessions, git

Gives every design, and every fix, its own branch `prelude/<design>` in a worktree under `~/.prelude/worktrees/`, and commits each turn there. Finishing merges into main without touching the person's checkout, or pushes for a pull request after asking.

## Responsible for
- Making, updating and tidying worktrees
- Committing turns, merging, publishing (`gh`, `az`)
- Git questions the pages ask: what changed, what's ahead, what's merged

## Not its job
- Writing to the person's own checkout

## Owns
- The worktrees and `~/.prelude/builds.json`
