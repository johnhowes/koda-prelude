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
8. New plan answers with the list, the new plan at the top while its steps
   are drafted (the plan’s page needed fields a bare post doesn’t carry).
9. **One build per design** (the person, 2026-10-23: no build covers two
   today), on that design’s branch. A build that uses code another build
   makes waits for that build (R-n7b): the Build page’s and Fix Something’s
   builds wait for Design Workspace’s, which makes the parser and partials.
10. **A build starts only from approved screens** (R-a5r): a design step is
   done when approved, and a design changed since stops its build starting,
   as Prelude already refuses a build checked against old screens.
11. **The way in is Project Landing Page’s** (the person, 2026-10-23): a
   prompt for it was given in the chat (a Plans link, In progress grouped by
   plan, plans needing the person in Needs you).

12. **The plan lives in the project, on its own branch** (the person,
   2026-10-23; R-q2x): `prelude/plan-<id>`, its file
   `prelude/plans/<id>/plan.json`, written only by the plan’s session.
   Prelude reads it from that worktree while it runs, so no step waits for
   it; finished, the branch goes into main the project’s usual way (a pull
   request here). The page shows the branch under the title.
13. **A design and its build share a branch when nothing else needs the
   design first** (the person, 2026-10-23; R-k4d), one pull request for
   both, as Prelude already finishes them. The design step is then
   “Approved” (not merged), and its build waits for that approval
   (`waitsFor[].until: "approved"`). Design Workspace’s design is needed by
   Fix Something and Build, so it’s finished first; Fix Something and Build
   each go in one pull request with their builds.

## Open questions

- **The architecture**: building this needs a new part in Designs and hosting
  (reading plans, working out where steps stand, starting them) and a
  planning prompt in agent. Propose the decision when it’s built.
- **The planning session uses the app’s chat** (the person, 2026-10-23), as
  design, build and fix sessions do. Recommended, waiting on the person: the
  plan’s page becomes a session page, the chat beside the plan as its
  surface (as a design page has the design), so the steps appear as the
  agent drafts them; Talk it over goes. The other way: a chat-only page, as
  a fix’s, linked from the plan.
