# Plans
layer: Project files
kind: module
short: Plans: one change through several designs
files: server/plans.js
uses:

A project's plans (D-j6p): each carries one change through several designs, builds and the architecture, in order. A plan is `prelude/plans/<id>/plan.json`: what the person asked for, the brief, and its steps as the agent drafted them (each one's prompt, owner, branch and what it waits for). It's drafted on a branch of its own, `prelude/plan-<id>`, and goes into main when it's started.

## Responsible for
- Listing, reading and creating plans
- A new plan's id, from its title or its goal

## Not its job
- Where a step stands: that's worked out from git, approvals and sessions, by the page models, never stored
- Making the plan's branch, or starting a step

## Owns
- `prelude/plans/`
