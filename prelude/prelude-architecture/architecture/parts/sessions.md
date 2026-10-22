# Sessions
layer: Project files
kind: module
short: Transcripts, drafts, questions
files: server/sessions.js, server/drafts.js, server/asked.js
uses: designs

A session's files: `session.json` and the append-only `transcript.jsonl`, named so folders never collide. Drafts keep each session's unsent message and images, and "Asked lately" keeps conversations that have no branch yet; both stay on this computer.

## Responsible for
- Creating, reading and appending to sessions
- Unsent drafts, and questions before they become fixes

## Not its job
- Running turns

## Owns
- `sessions/<id>/` in each design, `~/.prelude/drafts/`, `~/.prelude/asked/`
