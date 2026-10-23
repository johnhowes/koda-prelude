# Designs
layer: Project files
kind: module
short: Designs, fixes, app settings, snapshots
files: server/designs.js, server/fixes.js, server/app-config.js, server/snapshots.js
uses:

Finds and creates designs: any folder under `prelude/` with a `design.json`, including the special kinds (system, shell, architecture) and fixes in `prelude/fixes/<slug>/`. It also reads `prelude.json`'s app settings and keeps each design's approved screens.

## Responsible for
- Listing, finding and creating designs and fixes
- The app's stack and path (`prelude.json`)
- The app's Koda: where it's installed (worktree, then checkout) and its version (D-k7v)
- Approved screens in `snapshots/`, compared as normalised HTML

## Not its job
- Serving or rendering designs

## Owns
- `design.json`, `fix.json`, `prelude/prelude.json`, `snapshots/`
