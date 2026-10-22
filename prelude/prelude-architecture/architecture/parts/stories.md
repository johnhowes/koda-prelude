# Backlog and increment
layer: Designs and hosting
kind: module
short: What's left to build, what changed
files: server/backlog.js, server/increment.js, server/rules.js
uses: host, branches, designs

Works out what's left to build. `rules.js` reads a design's `RULES.md`; `backlog.js` derives the changes, by page; `increment.js` compares a design on its branch with where it left main, so a changed page's build covers only the change.

## Responsible for
- Each group's lines: new, changed, to build or unchanged
- Reading rules and events into words for prompts and pages

## Not its job
- Writing stories or running builds

## Owns
- Nothing: everything is derived from the design's files
