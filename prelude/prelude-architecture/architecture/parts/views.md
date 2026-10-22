# Views
layer: Pages
kind: module
short: Eta views, CSS, design system
files: server/views.js, server/views/**, server/public/*.css, server/public/ds/**
uses: koda

Prelude's own views and styles. `server/views.js` renders them with Eta and turns transcript entries into HTML with Koda's `renderMarkdown`; `_name.eta` is a fragment and `layout.eta` wraps it for a cold load. `server/public/ds/v1` is the design system, copied from KodaDesign.

## Responsible for
- Every page and fragment Prelude itself shows
- Safe rendering of agent messages
- Prelude's CSS and icons

## Not its job
- Rendering a design's views (the renderer does, sandboxed)
- Preparing data: views get a model ready to print

## Owns
- `server/views/`, `server/public/`
