# Command-line tools
layer: Entry points
kind: process
short: npm run check, skills, reference host
files: tools/**
uses: designs, folders, host

Small scripts run from npm. `check.js` runs the whole after-turn check for CI, `copy-skills.js` copies Koda's skills into `.claude/skills/`, and `reference-host.js` is the host contract in a page of Node, used by the tests.

## Responsible for
- `npm run check <folder>`: render every route in every state, exit 1 on a failure or a difference (`--approve` approves instead)
- `npm run skills` after a Koda upgrade
- Showing other stacks what a host must answer

## Not its job
- Anything the running server needs

## Owns
- Nothing beyond the snapshots `--approve` writes
