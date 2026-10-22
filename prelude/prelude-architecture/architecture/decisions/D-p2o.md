# Designs are served on their own origin
status: accepted
date: 2026-10-14
parts: preview, host, server

## Context
A design's screens are framed beside the chat. Sandboxing the frame loses localStorage and same-origin fonts, but serving designs on Prelude's own origin would let them post to Prelude.

## Decision
Design files are served on `preview.localhost` on Prelude's port, and a design with routes on `<design>.<folder>.preview.localhost`. Every POST to Prelude must come from Prelude's own origin.

## Consequences
Designs behave as they would on their own site, with relative links between designs working. Prelude refuses posts from screens and other sites alike.
