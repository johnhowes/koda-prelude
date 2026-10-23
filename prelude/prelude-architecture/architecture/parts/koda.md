# Koda and Eta
layer: Outside
kind: outside
short: Page runtime, templates
files:
uses:

`@kodalang/core` (pinned) gives the page its behaviour (fragments, regions, live events), `renderMarkdown` and the skills agents follow. Agents follow the app's own copy when it has one, and Prelude's only when it hasn't (D-k7v). `eta` is the template engine for Prelude's views and a design's.

## Responsible for
- The "one URL, two shapes" contract in the browser
- Templates and safe markdown

## Not its job
- Anything about designs or projects

## Owns
- `node_modules/@kodalang/core`, copied skills in `.claude/skills/`
