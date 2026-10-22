# Project Landing Page - notes

A project's own page (`/f/<id>`), a redesign of `server/views/_folder.eta` (with
`_branch.eta`), whose model is built in `server/main.js` (`view()` in the
`/f/:id` handler). Home (prelude/landing-page) gathers what needs the person
across projects and links here; this page holds the project's whole picture.

Pages: `/f/:project` (Project), `/f/:project/designs/new` (New design, modal),
`/f/:project/branches/:branch/publish` (Push a branch, modal),
`/f/:project/cleanup` (Clean up, modal), `/f/:project/branches/:branch/discard`
(Discard a branch, modal). Fragments:
`/f/:project/work`, `/f/:project/app`. States: typical (spark-lending), new
project, app being built, update clashed (with the app on the shell's branch
and a failed push), long names (an existing app to connect, no remote),
large project (a hundred features).

## Decisions (the person asked for all eleven, 2026-10-18)

1. **On the design system**, not ds/v1 + `prelude.css`, like Home.
2. **Work beside setup**: a `.split` in a `.center.wide`. Main: Needs you, In
   progress, Designs. Side: The app, What the agent can read. Added
   `.center.wide` / `--measure-wide` to the design system (46rem can't hold a
   split).
3. **New design is a modal**, opened by the header's "New design…", the page's
   one primary action. A refused title comes back into the fields alone
   (`_new-design-fields`); made, the modal closes and the page refreshes (the
   real app opens the new design's page).
4. **One primary per view**: Merge, Push, Start the app build are plain buttons.
5. **A branch's state as pills**: check, building / build stopped, behind main,
   pull request open, nothing done yet. Stories get a state pill (Built, To
   build, Building) and "A change". "Also changes" is a disclosure with the
   full list.
6. **Designs show progress**: pages and how many approved or built, and when
   they last changed. Grouped by area, those with none (system, shell) first.
   A plain "Ready to build" pill when approved pages aren't built yet, once
   the app exists (the person, 2026-10-18; R-r6b). Plain, as on Home.
7. **Needs you, here**: Home's rows for this project alone, newest first, and
   no card when nothing's waiting (R-v7q).
8. **Push asks in a modal** (`GET …/publish`), not a card at the top of the
   page; pushed, the modal closes, the page refreshes, and the shell's
   `notice?` says so. A failed finish stays beside its branch.
9. **Live**: the work and the app are regions reloading on `needs-changed` and
   `projects-changed` (Home's events), and every five minutes. Copy all stories
   stays inside the work region.
10. **First run**: no designs is a `.empty.page` in the main column, "Create the
    first design…", with links to start with the design system or app shell
    instead (`?kind=` preselects the modal). The app card waits until there's
    a design or a stack.
11. **"Project" in every word**; a folder the agent reads is still a folder.
    Changed the design system's Words table to match (the person's decision,
    2026-10-16).

Also: the app card no longer repeats the shell's branch (it's under In
progress); it says where to finish it. Which design system and shell designs
use moved from the New design form to the app card.

## What building it changes in the app

- New GET routes: `/f/:id/work`, `/f/:id/designs?q=&stage=`, `/f/:id/app` (fragments), `/f/:id/designs/new`
  and `/f/:id/branches/:bid/publish` (modals over the page).
- Forms aim at regions and answer with fragments (work, app, references,
  the fields) instead of re-rendering the page; `back` fields go.
- Removing a reference posts to `/f/:id/references/:ref/remove`: references
  need ids (today the path is posted).
- `branchState()` gains `building.stopped`, `pushed`, `remote.pulls`, and the
  model gains `needs` (this project's), each design's `pages`/`approved`/
  `built`/`changed`, and `app.status`.
- The app's layout (`server/views/layout.eta`) has the modal region and the
  live channel (from Home's build) but not `notice?`: "Pushed …" is dropped
  until it does (it's optional; the row says "Pull request open" anyway).
- The page needs the design system (`system: true`), as Home does.
- In the design, Merge just removes the branch from In progress; the app
  redirects to the design's page.

## At scale: a hundred features (the person, 2026-10-19)

- **Designs is its own region with search and a filter**: search as you type
  (title or area, `?q=`) and All / Ready to build / Still designing
  (`?stage=`). The page route filters the same way, so a filtered URL loads
  as a page and works without script. Each area heading shows its count; a
  search that matches nothing says so. Merged lately hides while filtering.
- **`stage` is prepared by the app** per design: `ready` (approved pages not
  built, once the app exists), `designing` (pages left to approve, or none
  yet), `approved`, `built`. The filter matches on it, and it drives the
  Ready to build pill.
- **Designs reload only on `projects-changed`**; the work (Needs you, In
  progress) on both events. Reading a hundred designs' progress on every
  finished turn would be slow.
- **A branch's stories fold** into "3 stories · 2 to build · 1 building",
  so a dozen branches still fit. The first-run page moved from the work
  region into the page.
- State `large-project`: 88 designs in eight areas, 12 branches, 3 needs
  (9 until Needs you kept only what needs acting on, 2026-10-19).

## Also decided

- **Finishing a branch stays on this page**, as well as on the design's (the
  person had no strong view, 2026-10-18): it's where every branch is seen
  together.

## Built (2026-10-19)

The views are the app's now, in `server/views/projects/`; the model is
`server/project.js` (`projectOf`, typed from the states), answered from the
`/f/:id` handler in `server/main.js`. The page is in the app layout on the
design system (`layoutOfPath` says so), like Home. Its styles are in
`server/public/prelude.css`, under `@scope (.project)`. What differs from the
notes above, and why:

- **The layout has `notice?` now** (the shell's build brought it in), so
  "Pushed …" is said there, as designed.
- **The main region is `workspace`** in the app's layout: a push's answer
  addresses the page to `ko-into="workspace"` where the design says `main`.
- **Merge answers with the work**, as routes.json says, rather than going to
  the design's page: the branch leaves In progress, and the designs region
  (on `projects-changed`) lists its design again (R-2hx).
- **Needs you is Home's**: `needsOfProject()` in `server/home.js` runs Home's
  own reading for one project (R-v7q).
- **`approved` is all of a design's pages or none**: the app keeps one
  approval per design (its snapshots), not one per page, so "4 pages, 2
  approved" doesn't happen yet.
- **The events are the ones Home sends**: a turn starting or ending (its
  check included, so "the page renders again"), a push, a merge, an update
  and starting a build all `tell()` the app's channel; the work's
  five-minute read tidies branches merged on the Git server, which sends
  `projects-changed`, so the app follows too (R-8dz), though its own region
  has no timer.
- **Two forms carry what was refused on a cold load** (no script): New
  design's fields come from `it.$fields`, the folder field from
  `it.$reference`; both are `{}` as designed otherwise.
- **References have ids** (from their paths), for `…/references/:id/remove`.

## Needs you, only what needs acting on (fix, 2026-10-19)

Home's Needs you now lists only a question, a stopped build and a turn that
ended with an error (prelude/landing-page, R-n4v), so this page's does too
(R-v7q): ready to build is Designs' pill and filter, a pull request is In
progress's pill. The states lost their pull request, ready to build and
finished rows: typical keeps Rate lock's stopped build, update clashed has no
Needs you card now, and large project keeps 3 of its 9.

## Faster, and a merge on the Git server shows a moment later (fix, 2026-10-20)

The page, its work region and Push's modal ran git synchronously dozens of
times each (prelude/fixes/requests-seem-to-take-a-very-long-time-even-for-things),
holding up every request. Now a branch's baseline files are read in one go,
what's worked out from commits is kept until they move, and Push's modal reads
only its own branch. The remote is fetched beside the request, not in it: a
pull request merged on the Git server leaves In progress for Merged lately a
moment after the page arrives (its regions reload on `projects-changed`),
rather than as it arrives. The views and states are unchanged.

## Changed since approved isn't ready to build (fix, 2026-10-20)

A design approved once, then changed, was still "Ready to build" and "all
approved", so its Build page offered a build checked against screens that
weren't the design any more
(prelude/fixes/if-i-haven-t-approved-a-design-i-shouldn-t-be-able-to-go-to).
Now such a design is designing again, with no pill, and its line says "N pages,
changed since approved" (`changedSinceApproved` on the design; R-r6b) until
it's approved again. Large project's Save and resume shows it.

## The design system and shell by what they are (redesign, 2026-10-19)

They said "nothing designed yet" (the person): the app counts pages, and the
system has none (its screens are a gallery) and the shell's gallery is left
out on purpose. Now the system says "tokens and 29 components" and the shell
"2 layouts, all built" (its own non-gallery pages added, "2 layouts and 1
page"; built only once the app exists). "Nothing designed yet" stays for none.

- **Brought back for it**: `_designs` (changed) and `page`, which includes it;
  `page`'s other partials are copied unchanged, since a design view's
  includes resolve in the design. Their own fragment routes stay `@app`.
- **Building it**: `progressOf()` in `server/project.js` gives a system
  `components` (its `system/components/*.html`) and a shell `layouts` (its
  layouts) and `layoutsBuilt` (those ported: `unbuiltLayouts` says which).

Built (2026-10-19): `_designs` is ported over the app's; `page` was already
the app's, unchanged. `progressOf()` counts as above, with `layoutsBuilt` 0
until the app exists (nothing is ported before it). The `stage` follows the
states too, so the filter agrees with the line: a system with components is
`built` once the app exists and `approved` before, and `designing` with none;
a shell is `built` when its layouts and own pages all are. The story and the
design agree.

## Run the app from here (redesign, 2026-10-20)

The person asked to launch the app from main on this page. Decided:

- **A separate instance**, not the design host: its own command and
  address (`app.run`: `command`, `url`, `state` stopped / starting /
  running / failed, `log`). Its port is given as `PORT`; the address must be
  on this machine and not the host's (the app checks; the design only
  requires both).
- **Clicking Run is the approval** (the person): the button always shows the
  command beside it (R-h2w). Only once the app is built (on main).
- **The app build gives the default** (the person, 2026-10-20): building or
  connecting the app, the agent writes a run command and an address of its
  own into `prelude/prelude.json` (`"run": { "start", "url" }`, beside
  `host`), so the card starts set (typical). Changed on the card, it's kept
  on this computer and wins over the project's; the repository isn't
  touched.
- **Unset** (an app connected before this, or a build that couldn't say):
  the card asks for both and has "Save and run" (large project). Set,
  "Change how it runs" is a disclosure while it's stopped.
- Starting shows a pulse and Stop; the server opens the browser once it
  answers and says `app-changed` (the app region now reloads on it too);
  running shows its address, Open and Stop; failing shows the last of its
  output and "Run it again" (events `app-running`, `app-failed`).
- States: typical has it set and stopped; large project hasn't set it.

**Brought back for it**: `_app` (changed), `_run-fields` (new) and `page`
(its `ko-invoke` gains `event:app-changed`); page's other partials are
copied unchanged. Building it: a runner like `server/hosts.js` but for
`app.run`, started in the project's folder without `PRELUDE_HOST`, the whole
tree stopped with Prelude.

## Update from main says what it did (fix, 2026-10-20)

"Update from main" seemed to do nothing (the person). In the app, the
behind count is against local `main` but the update merges `origin/main`
when there's a remote, so unpushed local commits never come in and the
button stays; and what it did was said only on the design's page. The app
needs to update from whichever main is newer (local when diverged, as the
count is): a fix for "Ask or fix", not this design (R-u9d).

Here, the branch now says what the update did (`updated`: `from`,
`files`, given once with the work's answer, as `finishError` is): "Brought
main in: 2 files came in…" or "main had nothing new for this branch" (large
project, Document upload). The design's form posts `behind` as a stand-in
for the file count. **Brought back for it**: `_branch` (changed) and
`_work`, which includes it.

## Built: running the app, and what an update did (2026-10-20)

`_app` and `_branch` are ported over the app's, `_run-fields` is new beside
them, and `page` gains `event:app-changed`; `_work` was already the app's.
Every route's view is `@app` now.

- **The runner is `server/runs.js`**: one app per project, started from the
  project's own folder (never a branch's worktree) with `shell: true`, its
  `PORT` from its address, and `PRELUDE_HOST` taken out of its environment.
  It's `starting` until anything answers at the address, then `running`, and
  the browser opens it; one that exits before answering, or doesn't answer
  in three minutes, is `failed`, with the last 1500 characters of its output.
  One that exits after it answered is just `stopped`. Prelude quitting closes
  the server, which takes each one's whole tree down (R-5tj). Its state
  changing on its own says `app-changed` down the app's channel.
- **Where how it runs comes from** (R-p7c): `"run": { "start", "url" }` in
  `prelude/prelude.json`, which the app build's and the connection's
  instructions now ask the agent to write; saved on the card, it's kept in
  `runs.json` in Prelude's home, by the project's folder, and wins.
- **What the app checks** beyond the design's `require`: the address is
  `http://` on localhost (or 127.0.0.1), and is neither the design host's
  (`host.url`) nor Prelude's own port. Settings from the project are checked
  the same way when Run is clicked; refused there, the card shows it failed
  with why. Run and Save and run do nothing until the app is built.
- **A refused change without script** comes back as the page with the card's
  fields showing why, but not what was typed: the fields show what's saved.
  With script (the usual case) they come back with what was typed.
- **Update from main** (R-u9d) merges the remote's main only when it holds
  all of the local one, and the local one otherwise, so every commit it's
  counted behind comes in. The work's answer gives that branch `updated`
  (`from`, and `files`, the count of files that came in); a clash is said by
  the merging notice instead, and without script the page is answered with
  it rather than a redirect. The design's hidden `updated.from` /
  `updated.files` inputs were stand-ins for this and aren't in the app's form.
- The story (the design system and shell say what they hold) is untouched by
  this change, and still agrees with the design.

## Clean up (redesign, 2026-10-21)

Branches and worktrees pile up (the person). The cause of a merged PR still
"open": `published` in `builds.json` is set on push and never cleared, and
tidying removes a branch only when its tip is in main, so one that goes on
after its PR merged, or was squash-merged, stays. Decided:

- **Mechanical, on the project page** (the person): Clean up… is a modal
  (`/f/:project/cleanup`), a ghost button with a count in In progress's
  heading (a muted line at the card's foot went unseen, 2026-10-21). It lists
  what Prelude won't tidy itself, each with its reason; the person picks and
  removes (R-c3j). Kinds: pull request merged with commits since, a branch
  Prelude no longer lists (work in main), nothing done (a week old, R-m2e), a
  worktree it no longer lists (work not in main, uncommitted files), and a
  folder left from an earlier tidy. Only the safe ones start picked.
- **Origin is opt-in** (the person): its branches are a group apart, under a
  warning, never picked to start with (R-9xk).
- **Running agents aren't cleaned up** (the person wasn't sure they're a
  problem): one the agent is working in can't be picked (R-m2e).
- **Squash merges**: the app tells "in main" by a trial merge
  (`git merge-tree --write-tree`) that changes nothing, not ancestry; with the
  commit pushed recorded, a PR is merged once that commit's merge changes
  nothing, and `pullRequest` is `{ state, when, since }` (R-t5w). Tidy uses
  the same test, so squash-merged branches go by themselves. `gh`/`az` PR
  state confirms where available.
- The POST takes `removed.<id>` fields; in the design a removed branch stays
  under In progress (the design can't remove from two lists at once), the app
  takes it out.

**Brought back for it**: `page`, `_work` and `_branch` (changed: Clean up
line, the merged pull request); `page`'s other partials copied unchanged.
New: `_cleanup`, `_cleaned` (the notice).

## Built: Clean up, and a merged pull request (2026-10-21)

`_work` and `_branch` are ported over the app's; `_cleanup` and `_cleaned`
are new beside them in `server/views/projects/`. `page` was already the app's
as designed (only its partials changed), so it's unchanged. Every route's view
is `@app` again.

- **"In main" is a trial merge** (`isIn()` in `server/branches.js`): ancestry
  first, then `git merge-tree --write-tree`, in main when the merge's tree is
  main's own. Kept by the two commits' ids. `status().merged` uses it, so
  tidying takes squash-merged and rebased branches too (R-t5w).
- **The pull request** (`pullRequest()`): a push now records the commit
  pushed (`published.sha`); one pushed before this goes by the remote's copy
  of the branch. `since` counts the commits after it. Home's pull-request
  reading uses the same test. After each fetch, a pull request that changed
  state says `projects-changed`, as a tidy does, so a merge on the Git server
  shows within a fetch rather than at the next five-minute read.
- **What Clean up finds** (`leftBehind()`), from git and `builds.json` only:
  the listed branches merged with commits since, or untouched for a week
  (R-m2e); `prelude/` branches Prelude no longer lists; folders under its
  worktrees with no worktree in them; and `origin/prelude/` branches whose
  work is in main. A worktree Prelude didn't make, and whatever the checkout
  is on, are the person's own and never listed. Ids are hashes of where and
  the name. The fetch now prunes, so a branch deleted on the server isn't
  offered.
- **Removing** (`clear()`) is only what was posted `true` last for an id
  (the hidden `false` comes first), matched against what's found again, so a
  form can't name anything else; one the agent is working in is refused even
  if posted (R-m2e). A design host in the worktree is stopped first. A branch
  Prelude lists leaves `builds.json`, so it leaves In progress (the design
  can't show that). On origin it's `git push origin --delete`; one already
  gone there just loses its copy here.

What differs from the design, and why:

- **"Merged 3 days ago" is when Prelude first saw it in main**, not the
  server's merge time: git doesn't record when a squash landed. It's kept, so
  it doesn't move.
- **`gh`/`az` don't confirm the pull request's state** (the story suggests
  it): they'd run synchronously on every read of the work. The trial merge
  alone decides.
- **A squash merge that main has changed again since** (the same lines
  edited after it) clashes in the trial merge, so that branch reads as not in
  main: it stays In progress, its pull request "open". Rare, but possible.
- **`unlisted` also covers** a `prelude/` branch with no worktree whose work
  isn't in main, and a branch in main whose worktree has uncommitted files
  (its line then says its work is in main, and warns of the files).
- **"Working" is known only for branches Prelude lists**: an unlisted
  worktree has no turn Prelude could be running.
- **A removal that fails is logged and left listed**; the notice names only
  what went. `_cleaned` has no place to say why one couldn't go.

The stories (a merged pull request, Clean up) agree with the design as built.

## Discard a branch unfinished (redesign, 2026-10-21)

Several designs and builds were ideas that went nowhere, and there was no way
to drop one without merging it or opening a pull request (the person). Decided:

- **Discard… on the branch's own card** (the person's suggestion), not in
  Clean up: Clean up stays for what Prelude left behind. "Discard", not
  "Remove" (the person): it says the work is thrown away. A quiet ghost
  button at the end of the card's actions, shown on every branch (clashed
  update included) except one the agent is working in (R-w8p).
- **It asks first in the modal** (`GET …/branches/:branch/discard`) and says
  what goes: the design itself when it's never been merged (`inMain` false),
  otherwise only the branch's changes; `ahead` commits, `uncommitted` files,
  built stories' code, a build, files outside the design, the app running
  from it. Nothing done on it says nothing is lost. The confirm is `.danger`.
- **A pushed branch's copy on origin** is a separate box, never ticked to
  start with (`remote`); deleting it closes an open pull request.
- Discarded, the modal closes and the page refreshes; no notice (the branch
  leaving In progress says it, as for Merge). A design in main is listed
  under Designs again (R-2hx); the design can't show that.
- The branch model gains `ahead`, `uncommitted`, `inMain`, `working` (Clean
  up's items already have the first three and `working`).

**Brought back for it**: `page`, `_work` (unchanged, so their includes resolve
here) and `_branch` (changed); page's other partials copied unchanged. New:
`_discard`. The POST answers now render the design's `page` and `_work`.

## Built: Discard a branch (2026-10-21)

`_branch` is ported over the app's and `_discard` is new beside it in
`server/views/projects/`; `page` and `_work` were already the app's as
designed, so they're unchanged. Every route's view is `@app` again.

- **The model** (`branchesOf()` in `server/project.js`): `ahead` is the
  count `status()` already made; `uncommitted` is `git status --porcelain` in
  the branch's worktree (`uncommittedIn()` in `server/branches.js`, which
  Clean up now shares), one more git call per branch on each read of the
  work; `inMain` is whether the design is listed on main; `working` is
  whether a turn is running in the worktree, as Clean up reads it.
- **Discarding** (`discard()` in `server/branches.js`) is Clean up's `clear()`
  for the branch: whatever runs from the worktree stopped, the worktree and
  branch deleted, and the branch out of `builds.json`, so it leaves In
  progress; no note under Merged lately, since nothing was merged. The copy on
  origin goes first, and only when `remote` was posted `true` last (the hidden
  `false` comes first) for a branch Prelude pushed: one that can't be deleted
  there leaves everything here as it was. One already gone there just loses
  its copy here.
- **A turn running** refuses the POST too (409), answering the question
  again, which then says the agent is working (R-w8p); the page doesn't offer
  Discard then either.
- **A discard that fails** says why beside its branch (`finishError`), with
  the page, as a failed push does. Done, the modal closes and the page comes
  back into `workspace` (the design's `main`), no notice, as designed.
- The stories (a merged pull request, Clean up) were written before Discard
  and don't mention it; nothing in them disagrees with the design.
## A shell's linked layouts count (fix, 2026-10-21)

A shell whose layouts are all the app's files (named in its `layouts.json`,
with no `layouts/<name>.eta` of its own, as connecting an app it already had
leaves it) read "nothing designed yet", `designing` (the person, Prelude
Shell). `progressOf()` now counts its layouts as `allShellLayouts()` in
`server/host.js` lists them, its own and the linked ones, and the linked ones
are built: "2 layouts, all built", `built`. The design already shows this
(typical's Spark Shell); the views and states are unchanged.

## Reference: read the design system and architecture (redesign, 2026-10-22)

Reading them is by far their most common use, and it needed a design
session (the person). Decided:

- **A Reference card at the top of the side column** (the person chose it
  over making the Designs rows open the read-only view): it's always in
  sight, and searching or filtering Designs doesn't hide it. The rows link to
  `/f/:project/system` and `/f/:project/architecture`, the counts beneath
  them. A row shows once there's something in it (components, parts), and
  the card shows once a row does (R-x4b). The Designs rows still open the
  design pages, which is where you change them.
- **No app shell** (the person: leave it out for now).
- **The design system gets a page of its own in the app**, as Architecture
  has (the person: treat them the same). The Prelude Design System design
  makes it, as the Architecture design made Architecture's; its gallery today
  is plain HTML on the preview origin. See Open questions.
- Designs lists the architecture design too: "Architecture" pill, document
  icon, "14 parts and 9 decisions".
- The model gains `system.components` and `architecture` (`id`, `title`,
  `parts`, `decisions`, or null if there isn't one).

**Brought back for it**: `page` (changed), `_designs` (changed); page's other
partials are copied unchanged. New: `_reference`.

## Built: Reference (2026-10-22)

`page` and `_designs` are ported over the app's, and `_reference` is new
beside them in `server/views/projects/`. Every route's view is `@app` again.

- **The model** (`projectOf()` in `server/project.js`): `system` gains
  `components` (its `system/components/*.html`, as its Designs row counts
  them), and `architecture` is `{ id, title, parts, decisions }` or null: its
  `architecture/parts/*.md` and `decisions/*.md`. Each is read where the
  design is, in main or on its own branch while it's only there, as the
  Architecture pages find it (`findArchitecture`).
- **An architecture counts nothing until its overview is written**: the
  Architecture pages show nothing before then (`isWritten`), so the card
  doesn't link to an empty page, and its Designs row says "nothing written
  yet".
- **An architecture's `stage`** is `approved` once it has parts and
  `designing` before: it's markdown, never built, so the filter shows it
  under Still designing only while it's empty.
- **`/f/:project/system` takes you to the design system's gallery**, its
  first screen on the preview origin, until the Prelude Design System design
  gives it a page of its own (see Open questions). With no gallery it goes
  back to the project's page.

## Reference always offers both, and New design the architecture (fix, 2026-10-22)

A project with no architecture had no way to one from this page: the
Reference card hid empty rows (and itself), and New design offered only the
system and shell kinds (prelude/fixes/after-the-most-recent-change-should-i-be-able-to-create-an).
The person decided both rows always show, so it's clear they're available,
and New design offers the architecture too (R-x4b, R-wm3):

- **Design system**: with components, `/system` as before; made but empty,
  its design ("Nothing designed yet · design it with the agent"); not made,
  New design with `?kind=system` in the modal ("Design system", "Not made
  yet · …").
- **Architecture**: always `/architecture`, whose empty page drafts it
  ("Nothing written yet · draft it from the code").
- **New design's Kind** gains "The project’s architecture" until there is
  one; the stack hint says the architecture, like the system, can start
  straight away. `?kind=architecture` (the Architecture page's) is unchanged.

`_reference` and `_new-design` changed in place (both `@app`). New project
shows neither made; long names an empty design system and no architecture.

## Fixed: reading the design system, and making the architecture (2026-10-22)

From the fix "I added support for a project's architecture view…"
(prelude/fixes/i-added-support-for-a-project-s-architecture-view-a):

- **`/f/:project/system` is a page of the app now**, not a redirect to the
  bare gallery: designed in a design of its own, Design System Page
  (prelude/design-system-page), since a design of kind `system` is only its
  gallery and can't have routes. The Reference card's link is unchanged.
- **New design offers "The project’s architecture"** as a kind while the
  project has none (R-wm3 now says so), as it does the system and the shell.
  Before, the only way to make one was the Architecture page's empty state,
  which nothing linked to until an architecture was written. The view
  (`_new-design`) changed; the `new-project` state's New design shows the new
  choice.

## Fixed: the architecture offered twice in New design (2026-10-22)

The two fixes above each added "The project’s architecture" to New design's
Kind, worded differently; merging both kept both radios. `_new-design` keeps
the one worded like the modal's own intro ("drafted from the code; every agent
reads it before it changes anything")
(prelude/fixes/the-option-to-create-an-architecture-is-duplicated-in-the).

## Open questions

- **Running it while the design host runs in the same folder**: two
  `dotnet run`s in one folder fight over `bin/obj`. The run may need its own
  output folder, or to stop the host first; let the build find out.

- **New design has nowhere to say why the kind was refused**: designs here
  wait for the app to be connected (or for a custom stack's app to be
  built), and a project has one design system and one shell. The fields hold
  only the title and area, so the app says it under the title for now. A
  line in the fields for `$errors.kind` would put it in its place.
- **Starting the app build can fail** (a branch git couldn't make, the agent
  busy): `_app` has no place for it, so the app answers with the app and
  says why in `notice?`.
