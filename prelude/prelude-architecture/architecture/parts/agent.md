# Agent
layer: Agent and live state
kind: module
short: Prompts and the Claude CLI
files: server/agent.js
uses: stories, visuals, claude

Runs the Claude Code CLI and holds every prompt Prelude gives it: design, build, app build, connect, story, fix, ask and a plan's (D-j6p). It also holds the architecture briefs: one for changing code, and a read-only one for ask. Once the project has an architecture, every prompt gets the visual vocabulary, taken from `visuals`. It sets the permission flags that fence what the agent may read and write, and normalises the CLI's stream into transcript entries.

## Responsible for
- The prompt for each kind of design and each mode
- The architecture briefs, and the vocabulary in design, build, fix and ask prompts
- `--allowedTools` and `--add-dir`: never a bare Read, Glob or Grep
- Spawning and resuming the CLI, and summarising its tool calls

## Not its job
- When a turn runs, or what's done with its output (turns)
- Choosing which Koda the prompts point at (designs, server)
- Describing the vocabulary: visuals does, so the parser and its description change together

## Owns
- The prompts and permission rules
