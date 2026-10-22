# The project's folder is the database
status: accepted
date: 2026-10-14
parts: designs, sessions, folders

## Context
Designs are worked on by several people, over many sessions, on different machines and branches. A database or a shared service would have to be run, backed up and kept in step with the code.

## Decision
Everything Prelude produces is a file under the project's `prelude/` folder, committed alongside the code. Only machine-local conveniences (recent projects, drafts, approvals, worktrees) live in `~/.prelude/`.

## Consequences
Designs travel with branches and pull requests, and nothing is lost if `~/.prelude/` is deleted. Files must merge cleanly: random session folder names, append-only transcripts, no shared index.
