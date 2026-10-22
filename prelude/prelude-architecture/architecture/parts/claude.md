# Claude Code CLI
layer: Outside
kind: outside
short: The agent
files:
uses:

The agent itself: `claude -p` with streamed JSON output, run in the project's folder or worktree. Its own session store is machine-local, so a session resumes only on the machine that started it.

## Responsible for
- Reading the project and writing the files a turn changes

## Not its job
- Deciding what it may touch: Prelude's flags do

## Owns
- Its conversation history, on this machine
