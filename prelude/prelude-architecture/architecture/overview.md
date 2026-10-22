# Prelude architecture

Prelude is a tool for designing and then building an app with an agent: you pick a project, chat with the Claude Code CLI, and watch the design appear beside the chat. It runs as one Node server (plain `node:http`, views in Eta, Koda in the page) on localhost:4200, optionally inside a Tauri desktop window. Everything it produces is files in the project's `prelude/` folder, each design worked on in its own git branch and worktree. Agent-written views render in a sandboxed child process, and each design is served on its own preview origin.

## Layers

1. Windows
2. Entry points
3. Pages
4. Agent and live state
5. Designs and hosting
6. Project files
7. Outside

## Principles

- **The folder is the database.** Everything Prelude makes is a file under the project's `prelude/`, committed with the code; `~/.prelude/` holds only machine-local conveniences, so nothing is lost if it's deleted.
- **The server is the single source of truth for live state.** Every window (chat, pop-out, browser tab) renders from the server and re-renders on its SSE events, so no window holds state another needs.
- **Agent-written code never runs in the server's process.** A design's views render in a sandboxed renderer, and a host that runs them unsandboxed starts only once the person approves it.
- **The agent works with ordinary file tools, fenced to what it may touch.** It reads the project and the folders added as references, writes only where its mode allows, and deletes by writing a file empty.
- **A design's memory is its files, not a conversation.** Each session starts from NOTES.md, the views and states, so sessions on different machines and branches pick up where the work stands.
- **Committed files must merge cleanly.** Session folders and decision ids are random, transcripts are append-only, and there's no shared index that every session rewrites.
- **Every native feature has a web fallback.** The desktop shell makes things nicer; it never makes them possible.
