# Server
layer: Entry points
kind: process
short: HTTP routes, one URL two shapes
files: start.js, server/main.js
uses: pages, architecture, turns, views, agent, live, media, host, runs, stories, branches, designs, sessions, folders, preview

Prelude's server: plain `node:http` with every route in `server/main.js`, started by `start.js`. It follows Koda's contract, answering each URL as a whole page or as a fragment, and wires the other parts together for each request and each turn.

## Responsible for
- Routing, and refusing POSTs that don't come from Prelude's own origin
- Starting turns with the right prompt, mode and permissions, and what follows a turn (review, commit, drift check)
- Sending requests for a design's origin to the host

## Not its job
- Building page models or rendering agent-written views
- Talking to the CLI or git directly

## Owns
- The in-memory app: folders, channels, turns, renderers, hosts and runs it created
