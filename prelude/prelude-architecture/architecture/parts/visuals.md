# Visuals
layer: Shared helpers
kind: module
short: Visual blocks: parse, check, describe
files: server/visuals.js
uses:

The vocabulary agents draw with (D-v3x): fenced blocks tagged `prelude-<kind>-<version>`, such as `prelude-flow-1` and `prelude-map-1`. It holds a registry of kinds. Each kind has a parser for every version it has shipped, a check against the architecture's parts, and the lines that describe its current version to the agent. It is pure and imports nothing, so `views`, `agent` and `architecture` can all use it.

## Responsible for
- Splitting a message into text and blocks, by Koda's fence rule
- Parsing and checking a block into a model for its partial, or saying it isn't one
- The vocabulary's description for prompts, current version only
- Parsing a flow's steps, for flow files and flow blocks alike

## Not its job
- Rendering HTML (views, with `_visual-<kind>.eta`)
- Reading the architecture: it's given the parts and layers

## Owns
- The registry of kinds and their versions
