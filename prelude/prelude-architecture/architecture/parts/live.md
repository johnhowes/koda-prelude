# Live state
layer: Agent and live state
kind: module
short: SSE channels, current screen
files: server/live.js, server/design-state.js
uses:

The server's live state and how windows hear of it. `live.js` holds the SSE channels; `design-state.js` holds each design's current screen, version and open windows, and its working copy of a state, announcing every change as `design-changed`.

## Responsible for
- Sending events to every window on a channel
- Each design's screen on show, its pop-outs, and the working copy forms change

## Not its job
- Anything written to the folder: this state is never saved

## Owns
- Channels and per-design state, in memory
