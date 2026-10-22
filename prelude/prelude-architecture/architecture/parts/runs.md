# App runs
layer: Designs and hosting
kind: module
short: Starts the built app
files: server/runs.js
uses: host, designs

Runs the app a build made or connected, from the project's own folder (its main branch), with a command and address of its own. It's apart from the design host, which renders designs: this is the real app, started from the project's page.

## Responsible for
- Reading how the app runs (`prelude.json`'s `run`), with this computer's override
- Starting it, opening it once it answers, and stopping its whole process tree with Prelude

## Not its job
- Rendering designs or serving a design's origin (host)

## Owns
- The app's process, and `~/.prelude/runs.json`
