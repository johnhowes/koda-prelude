# Design host
layer: Designs and hosting
kind: module
short: Serves designs on their own origin
files: server/host.js, server/hosts.js, server/renderers.js, server/events.js
uses: renderer, stories, designs

Serves a design with `routes.json` on its own origin, `<design>.<folder>.preview.localhost`: it finds each route's data in the current state, wraps pages in a layout, and answers each URL in two shapes. Views render in the sandboxed renderer, or through another stack's host over HTTP once approved.

## Responsible for
- Routes, overlays, POST routes and query filters against a state's working copy
- A design's server events (`events.json`) and its live channel
- `reviewDesign`: rendering every route in every state after a turn
- Starting, stopping and approving hosts

## Not its job
- Rendering agent-written views in this process
- Changing a design's state files
- Running the built app for the person (runs)

## Owns
- Renderer and host processes, and `~/.prelude/approvals.json`
