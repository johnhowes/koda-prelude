# Agent
layer: Agent and live state
kind: module
short: Prompts and the Claude CLI
files: server/agent.js
uses: stories, claude

Runs the Claude Code CLI and holds every prompt Prelude gives it: design, build, app build, connect, story, fix and ask, plus the architecture brief. It sets the permission flags that fence what the agent may read and write, and normalises the CLI's stream into transcript entries.

## Responsible for
- The prompt for each kind of design and each mode
- `--allowedTools` and `--add-dir`: never a bare Read, Glob or Grep
- Spawning and resuming the CLI, and summarising its tool calls

## Not its job
- When a turn runs, or what's done with its output (turns)

## Owns
- The prompts and permission rules
