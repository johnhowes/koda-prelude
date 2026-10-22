# Preview files
layer: Project files
kind: module
short: Serves and watches prelude/ files
files: server/preview.js
uses:

Serves the project's whole `prelude/` folder at `/f/<folder>/p/<path>`, only on `preview.localhost` and never a `sessions/` folder, so relative links between designs work. It lists a design's screens and watches design folders for changes.

## Responsible for
- Static design files and their content types
- Telling the server when a design's files change

## Not its job
- Routes and states (the host)

## Owns
- File watchers, in memory
