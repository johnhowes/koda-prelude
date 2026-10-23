# Coordinator - notes

A way to carry one change that spans several designs, builds and the
architecture through Prelude in the right order. The case that started it
(2026-10-23): rich visuals in sessions (D-v3x). The person kept six prompts
by hand: Architecture, Prelude Design System, Design Workspace, Fix
Something, Design Build, and one build of Workspace and Build together.

## What those prompts show

- **A shared brief, then what's particular.** Every prompt restates the goal
  (visuals in the chat, no HTML from the agent, the design system's
  components). That belongs to the change, written once.
- **Steps point at each other's results by description**: "the
  architecture's new decision", "see the design system's NOTES.md". When a
  step starts, those can be named for real (D-v3x, the component files, rule
  ids). That's what filling in a prompt means.
- **A step sees only main.** Each runs in its own worktree, so a step can't
  see what it depends on until that's merged and its branch has been updated
  from main.
- **Steps differ in kind**: a discussion ("discuss it with me before writing
  anything"), design sessions that end in approved screens, and builds that
  end in tests and a passing check. One build covered two designs.
- **Something can go missing.** No prompt builds Fix Something's design.
  A plan you can see makes that gap obvious.

The graph they imply:

    Architecture ─────────┐
    Design system ────────┴─► Design Workspace ─┬─► Fix Something ─┐
                                                └─► Design Build ──┴─► Build

## Proposed shape (not decided yet)

- **A change has a brief and steps.** Each step has a target (the
  architecture, a design, a fix, or a build of one or more designs), its
  prompt, the steps it waits for, and what counts as done (decision merged,
  screens approved, check passing and merged).
- **The plan is a file; where it stands is worked out** from branches,
  sessions, approvals and stories, as the backlog does. That keeps to "the
  folder is the database" and merges cleanly.
- **Ready means merged into main.** The coordinator updates the step's
  branch from main before its first turn.
- **Prelude sequences; the agent writes.** The coordinating agent drafts the
  plan from a goal, and writes each step's prompt as it starts, naming what
  the steps before it actually produced.
- **The person keeps the gates.** Discussions and design sessions start with
  the drafted first message and are theirs from there; builds can run alone.
  Approving, merging and pushing ask, unless the person opts in per change.

## Open questions

- How much may it do without asking: start builds, merge locally, push?
- Where it lives in the UI: its own page, and grouping In progress by change
  on the project page?
- Will this need a new part (and a decision) in Designs and hosting, and a
  coordinating prompt in agent?
