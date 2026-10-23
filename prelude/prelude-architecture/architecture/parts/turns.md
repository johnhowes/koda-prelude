# Turns
layer: Pages
kind: module
short: One agent turn per design at a time
files: server/turns.js
uses: agent, sessions, views, pages, words

Runs a session's turns: one at a time per design, with messages sent meanwhile waiting their turn. It records what the agent says and does in the transcript, streams it to the chat, and tells the agent at the start of its next turn what Prelude found after the last (views that don't render, code that drifted).

## Responsible for
- The queue of turns per design, and stopping a turn
- Streaming entries live and saving finished ones
- Removing files the agent emptied, and running the after-turn hooks
- Recording the parts a build or fix turn changed, as an entry the chat draws as a map

## Not its job
- Building prompts or spawning the CLI (agent)
- Committing (branches) or rendering the review (host)

## Owns
- Running turns, waiting messages and pending findings, in memory
