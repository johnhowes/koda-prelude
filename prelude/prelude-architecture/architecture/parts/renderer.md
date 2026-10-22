# Renderer
layer: Designs and hosting
kind: process
short: Sandboxed Eta for agent views
files: server/renderer.js
uses: koda

A child process, started under Node's permission model, that renders a design's Eta views and nothing else. It may read the project and Prelude's own files, and may not write, start processes or load native code. It answers render requests over IPC.

## Responsible for
- Rendering a page, its layout and its regions to HTML
- Reporting a view's error instead of crashing the server

## Not its job
- Finding routes, data or layouts (the host sends them)

## Owns
- Nothing
