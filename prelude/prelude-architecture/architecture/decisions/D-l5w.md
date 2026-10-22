# Live state is the server's, and windows re-render from it
status: accepted
date: 2026-10-14
parts: live, server

## Context
A design can be open in the chat window, a pop-out and a browser tab at once, and each must show the same screen and transcript.

## Decision
The current screen, open windows and running turns are server state, held in memory and never written to the folder. Every change is announced over SSE (`design-changed`, transcript entries), and each window re-renders its regions from the server.

## Consequences
No window holds state another needs, and there's no client-side store. The state is lost on restart, which is acceptable for what it holds.
