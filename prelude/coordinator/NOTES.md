# Coordinator - notes

**Plans**: one change carried through several designs, builds and the
architecture in the right order, each step started when what it needs is in
main, with its prompt filled in from what the steps before it made. The case
that started it (2026-10-23): visuals in the chat (D-v3x), whose six prompts
the person kept by hand. That plan is the typical state.

Pages: `/f/:project/plans` (Plans), `/f/:project/plans/new` (New plan,
modal), `/f/:project/plans/:plan` (Plan), a step in the drawer
(`…/steps/:step`), Push a step (modal, `…/steps/:step/push`). Fragments:
`…/work` (needs you and the steps), `…/activity`. States: typical (half way:
architecture merged, the design system the person’s turn, the rest waiting),
planning (drafted, not started, no remote), build-stopped (a build stopped, a
design ready to push), done.

## What the person’s prompts showed

- Every prompt restated one brief: it’s the plan’s, written once.
- Steps pointed at each other’s results by description (“the architecture’s
  decision”); a started step names them (D-v3x). That is “filling in”.
- A step sees only main, from its own worktree.
- Steps end differently: a discussion, approved screens, a passing build. One
  build covered two designs.
- None of the six built Fix Something; the drafted plan adds it.

## Decisions

1. **Called a plan, made of steps** (2026-10-23). “Change” clashed with a
   story’s “A change” pill. A step is one discussion, design, build or fix on
   one branch, with its prompt, what it waits for and what counts as done.
2. **Ready means merged into main** (the person agreed, 2026-10-23): the step’s
   branch is brought up to date from main before its first turn (R-s6t).
3. **It starts steps by itself, never merges or pushes without asking**
   (the person agreed, 2026-10-23). A project with no remote can let the plan
   merge by itself (“By itself” card); with a remote each step is pushed by the
   person, asked in a modal, and the plan goes on once the pull request is
   merged (R-p4h). A design or discussion gets its first message from the plan;
   the rest of its session is the person’s.
4. **Where a step stands is worked out, not stored**: from its branch, session,
   approvals and stories, as the backlog is. States: not started, waiting,
   working, your turn, ready to finish, pull request open, build stopped,
   merged. A waiting step names only what it still waits for.
5. **The steps are a map, one layer per wave**: a step sits a layer below the
   last step it waits for, so side by side means at the same time. The design
   system’s map, no new component.
6. **The prompt is the draft until it starts, then what was sent** (R-m3k,
   R-f8d), with a list of what each description asked for and what it
   became. The brief is shown once, in the side column.
7. **The agent that drafts is talked to in the plan’s own session** (Talk it
   over), so adding or reordering steps is a conversation, not a form.
8. New plan answers with the plan’s page in the main region; the app goes to
   its URL.

## Open questions

- **Where the plan’s file lives.** It names steps on many branches, so it
  can’t be committed on each; on main (`prelude/plans/<id>/plan.json`), written
  only by the plan’s own session, is the likely answer.
- **The architecture**: building this needs a new part in Designs and hosting
  (reading plans, working out where steps stand, starting them) and a
  planning prompt in agent. Propose the decision when it’s built.
- **The way in**: a Plans link on the project’s page, and In progress grouped
  by plan, belong to Project Landing Page’s design.
- A build covering two designs: which branch does it run on?
- The plan’s session page (Talk it over) isn’t designed here: is it a design
  page’s chat without a surface?
