# Coordinator - notes

**Plans**: one change carried through several designs, builds and the
architecture in the right order, each step started when what it needs is in
main, with its prompt filled in from what the steps before it made. The case
that started it (2026-10-23): visuals in the chat (D-v3x), whose six prompts
the person kept by hand. That plan is the typical state.

Pages: `/f/:project/plans` (Plans), `/f/:project/plans/new` (New plan,
modal), `/f/:project/plans/:plan` (Plan), a step in the drawer
(`…/steps/:step`), Push a step (modal, `…/steps/:step/push`). Fragments:
`…/work` (needs you and the steps), `…/transcript`. States (John Howes at
the computer; Priya Raman designs, Marcus Bell builds): typical (a team,
architecture merged, Priya’s design system pull request open, the rest
waiting), planning (drafted, nobody assigned, no remote), build-stopped
(John alone: a build stopped, two designs approved waiting on it, asking why
in the chat), done (a team), handed-on (one step ready for Marcus, one in
progress on Priya’s computer, one ready to claim).

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
7. **The plan’s page is its session** (the person, 2026-10-23): the app’s
   chat beside the plan, filling the window, as a design’s page has the chat
   beside the design. Adding or reordering steps is a conversation, and the
   person sees the plan change beside it. Prelude says in the chat what
   happened as the plan runs (R-d6m), which replaced a separate history
   card. The chat here (`plans/_chat`, `_transcript`, `_composer`) is a
   stand-in: the build uses the app’s `_chat` with its session menu, Tools,
   queue, dictation and images. Layout rules are the app’s `.design-page`
   ones, copied for `.plan` in styles.css.
14. **The planning chat draws visuals** (the person, 2026-10-23), as every
   chat does (D-v3x): the planning prompt gets the vocabulary. The agent maps
   the parts a plan reaches when it drafts (typical) and explains a wait
   with a flow (build-stopped) (R-w5c); Prelude maps the parts a merged
   build step changed (done, R-u3t). The app’s `_message` and `_visual-*`
   partials are copied unchanged into `views/plans/`, so the transcript
   stand-in draws exactly what the app draws.
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
   Starting the plan puts it into main the project’s usual way (a pull
   request here), so teammates see it (decision 15). The page shows the
   branch in its header.
13. **A design and its build share a branch when nothing else needs the
   design first** (the person, 2026-10-23; R-k4d), one pull request for
   both, as Prelude already finishes them. The design step is then
   “Approved” (not merged), and its build waits for that approval
   (`waitsFor[].until: "approved"`). Design Workspace’s design is needed by
   Fix Something and Build, so it’s finished first; Fix Something and Build
   each go in one pull request with their builds.

15. **Several people share a plan** (the person, 2026-10-23: a PM plans, a
   designer designs and opens a pull request, a developer reviews it and
   builds).
   - **Owners are git identities** (`Name <email>`), from the people who
     have committed to the project; a team can be configured later. Given in
     the plan’s chat (the agent asks), not a form. `me` is who’s at this
     computer.
   - **An open step is claimed** (the person): ready and unowned, it’s in
     everyone’s Needs you with Claim it; claimed, it’s theirs and starts on
     their computer (R-b8y).
   - **A step starts only on its owner’s computer** (R-s6t); someone else’s
     ready step reads “Ready for Marcus” and is in his Needs you.
   - **Starting a plan puts it into main** (R-q2x, replacing “goes into main
     when finished”), so every teammate’s Prelude sees it; later edits go the
     same way. Where steps stand isn’t in it.
   - **Someone else’s step is read from the remote** (R-r3z): ready for
     them, in progress (branch pushed), pull request open, merged. The finer
     states only where it runs.
   - **A hand-off is a pull request**: a design and its build share a branch
     only when one person has both (R-k4d).
   - Steps show their owner (“You”, a name, “Anyone”), and Everyone’s / Mine
     filters the map with `:has()`. The drawer has Whose.

16. **Claim stays in Needs you** (the person, 2026-10-23), not the drawer.
17. **What else it takes** (2026-10-23): prompts were given in the chat for
   Prelude Architecture (the decision and the new part), Project Landing
   Page, Landing Page (Home), Design Workspace, Build and Fix Something, in
   that order of need. “Plan, step, claim” were added to the design system’s
   Words table here.

## Built (2026-10-23)

Plans, New plan and its post are built (`server/views/plans/`), with the
plan's file in a new part, `plans` (`server/plans.js`, proposed in D-j6p),
and where each step stands worked out in `server/plans-page.js`.

- A new plan is `prelude/plans/<id>/plan.json` on `prelude/plan-<id>`, its
  id from the title, or the goal's first words. The form's hidden
  `project.*` and `status` fields are ignored: the project is the URL's, and
  a new plan is always planning.
- R-c7n and R-a5r hold where a step's state is worked out: a step that
  hasn't started stays “Waiting”, saying why, while the plan is paused or
  its build's design isn't approved as it is now.
- The two server events come from the fetch the pages already make
  (`tidyFolder`): a step whose worked-out state moved sends
  `plans-changed`, and one that started (Priya's branch pushed) pushes
  `_started` into the notice.
- Not yet, with the plan's page: starting a step on its owner's computer
  (R-s6t). Until then a step of yours that's ready shows “Waiting”, saying
  “Ready: it starts here”: the states have no state for it, because it
  starts at once. Merged is found by what landed in main since the step
  could start, so starting a plan has to record `startedAt` in its file.
  The plan's chat isn't read yet (its entries are empty).

## Open questions

- **The architecture**: building this needs a new part in Designs and hosting
  (reading plans, working out where steps stand, starting them) and a
  planning prompt in agent: the Prelude Architecture prompt asks for the
  decision, before the build.
- New plan answers with the list; now that the plan’s page is where the
  agent drafts, the app should go straight to it.
