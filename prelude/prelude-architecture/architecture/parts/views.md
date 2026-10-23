# Views
layer: Pages
kind: module
short: Eta views, CSS, design system
files: server/views.js, server/views/**, server/public/*.css, server/public/ds/**
uses: visuals, koda

Prelude's own views and styles. `server/views.js` renders them with Eta and turns transcript entries into HTML. It takes visual blocks out of the agent's words with `visuals` and renders the rest with Koda's `renderMarkdown` (D-v3x). `_name.eta` is a fragment, and `layout.eta` wraps it for a cold load. `server/public/ds/v1` is the design system, copied from KodaDesign.

## Responsible for
- Every page and fragment Prelude itself shows
- Safe rendering of agent messages: escaped words, visuals only from checked models, and anything else as a code block
- A `_visual-<kind>.eta` partial per visual, and the map partial the Architecture page shares
- Prelude's CSS and icons

## Not its job
- Rendering a design's views (the renderer does, sandboxed)
- Preparing data: views get a model ready to print, with the architecture's parts given to them

## Owns
- `server/views/`, `server/public/`
