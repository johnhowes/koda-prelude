# Architecture
layer: Pages
kind: module
short: Reads these files, checks the code
files: server/architecture.js
uses: host, branches, designs, words, koda

Reads a project's architecture (a design of kind `architecture`, markdown in its `architecture/` folder) for the Architecture page, and checks the code against it. The files are the one source: what's derived, such as each part's "used by" and the map's layers, is prepared here.

## Responsible for
- Parsing the overview, parts, decisions and flows
- The drift check: imports a part may not make, uses of a layer above, code files no part names, named files that aren't there
- Keeping each project's last check, read again when its commit moves

## Not its job
- Writing the architecture: the agent does that
- Telling the agent what drifted (turns does, with the next message)

## Owns
- The last check per folder, in memory
