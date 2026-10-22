# The agent is the Claude Code CLI with ordinary file tools
status: accepted
date: 2026-10-14
parts: agent, claude, turns

## Context
The agent needs to read the project and write a design's files. Domain tools (MCP) would be a second API to keep in step with the files.

## Decision
Prelude runs `claude -p` in the project's folder with Read, Write, Edit, Glob and Grep, writes scoped by path to what its mode allows, and reads widened only by the reference folders (`--add-dir`). Never a bare Read, Glob or Grep. With no shell, it deletes a file by writing it empty, and Prelude removes it when the turn ends.

## Consequences
The agent works from the same files the person sees. Folder paths are kept in canonical long form, since a Windows short name stopped path-scoped permissions from matching.
