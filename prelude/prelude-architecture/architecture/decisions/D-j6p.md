# A plan is a file of its own in the project, and where its steps stand is worked out by the page models
status: proposed
date: 2026-10-23
parts: plans, pages, server, branches, designs, agent, turns

## Context
Coordinator's Plans carry one change through several designs, builds and the architecture, each step starting once what it waits for is in main. A plan has to be shared by everyone on the project (R-q2x), so it belongs in the project's files, but nothing in Project files owns it: `designs` finds folders with a `design.json`, and a plan isn't a design. Its steps' states (waiting, in progress elsewhere, pull request open, merged) change all the time and differ from one computer to the next, as each person's design branches do.

## Decision
A new part, `plans`, in Project files, owns `prelude/plans/<id>/plan.json`: the goal, the brief and the steps as drafted. `plans` is reserved in `designs`, so no design or area takes the name. A plan is drafted on its own branch, `prelude/plan-<id>`, which `branches` makes as it makes a fix's. Where each step stands is never stored: the page models (`server/plans-page.js`) work it out on every read, as they do a design's, from the step's branch here or on the remote, what the main line has, the design's approved screens and the turn running. The rules on what may start (a paused plan starts nothing new, R-c7n; a build waits for its design's screens approved as they are, R-a5r) are applied there. The server says what moved after each fetch, and as turns start and end, down the app's channel (`plans-changed`, and a notice for a step that started) and in the plan's session.

A plan's session is a session of `prelude/plans/<id>`, run by `turns` as a design's is, with its own prompt in `agent`: the agent writes only the plan's file. Its branch is kept by `branches` while the plan runs, since its file and session live there on each computer; the person's changes go into main from it the project's way, Prelude's own (a step started) are only committed. The server starts each of this person's ready steps (R-s6t), as the page models say, through the design's own routes: a design or discussion with its first message, a build with its first page.

## Consequences
Plans merge like any project file, and every teammate's Prelude reads the same plan while seeing the steps as their own computer and the remote show them. A step merged and its branch deleted is found by what landed under its design since it could start, so a plan needs its start time. A plan never pushes a step by itself; its own file is pushed only on the person's clicks (start, pause, a change), so a step started by itself reaches teammates with the next of those.
