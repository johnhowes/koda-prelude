# Coordinator - notes

A way to carry one change that spans several designs, builds and the
architecture through Prelude in the right order. The case that started it
(2026-10-23): rich visuals in sessions (D-v3x) needed an architecture
decision, then design and build work in three designs, each with its own
prompt, each started only once what it needs is merged.

## Proposed shape (not decided yet)

- **A change is a plan of steps.** Each step is one design, build or fix on
  one branch, with its prompt and the steps it waits for. Waiting is per
  step: a design session can often start at once, while its build waits for
  the architecture to be merged.
- **The plan is a file; where it stands is worked out.** Only the steps,
  their dependencies and prompts are written down. Whether a step is ready,
  running, waiting on the person or merged comes from the branches, sessions
  and stories, as the backlog already does. That keeps to "the folder is the
  database" and merges cleanly.
- **Prelude sequences; the agent writes.** Starting a ready step is
  mechanical. The coordinating agent drafts the plan from a goal, and writes
  each step's prompt when it's about to start, from what the earlier steps
  actually did (their NOTES and changes), not from a guess made at the start.
- **The person keeps the gates.** Approving screens, merging and pushing stay
  theirs (or are opt-in per change); a design session is a conversation, so
  the coordinator opens it with a drafted first message rather than running
  it alone. Builds can run unattended.

## Open questions

- How much may it do without asking: start builds, merge locally, push?
- Does a step wait for its prerequisite merged into main, or only approved
  or built on its branch (then brought in by updating from main)?
- Where it lives in the UI: its own page, and grouping In progress by change
  on the project page?
- Will this need a new part (and a decision) in Designs and hosting, and a
  coordinating prompt in agent?
