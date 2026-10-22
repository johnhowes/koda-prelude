# Every design works on its own branch, in a worktree
status: accepted
date: 2026-10-17
parts: branches, server

## Context
With designs in the person's working copy, a build cut from main could lack its design, merges went unnoticed, and a feature needing a design-system change had to wait for it to merge separately.

## Decision
Each design and fix gets a branch, `prelude/<design>`, and one worktree under `~/.prelude/worktrees/`, shared by its design and build sessions. Every turn is committed. Prelude never writes to the person's checkout: finishing merges into main without touching it, or pushes for a pull request after asking.

## Consequences
A build always has its design, and a design's agent may also change the system and shell on its branch. A worktree is treated as a project, so its sessions, host and check are a project's.
