# Projects
layer: Project files
kind: module
short: Recent projects, reference folders
files: server/folders.js
uses:

The projects Prelude knows: their canonical paths, ids and the recent list, and the reference folders the agent may also read. The code still says "folder" for a project.

## Responsible for
- Opening and remembering projects, in canonical long form
- Refusing folders Prelude can't use
- Each project's reference folders, passed to the agent as `--add-dir`

## Not its job
- What's inside a project's `prelude/` (designs, sessions)

## Owns
- `~/.prelude/folders.json` and the references list
