# Project Landing Page - notes

A project's own page (`/f/<id>`), a redesign of `server/views/_folder.eta` (with
`_branch.eta`), whose model is built in `server/main.js` (`view()` in the
`/f/:id` handler). Home (prelude/landing-page) gathers what needs the person
across projects and links here; this page holds the project's whole picture.

Pages: `/f/:project` (Project), `/f/:project/designs/new` (New design, modal),
`/f/:project/branches/:branch/publish` (Push a branch, modal). Fragments:
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

## Open questions

- **New design has nowhere to say why the kind was refused**: designs here
  wait for the app to be connected (or for a custom stack's app to be
  built), and a project has one design system and one shell. The fields hold
  only the title and area, so the app says it under the title for now. A
  line in the fields for `$errors.kind` would put it in its place.
- **Starting the app build can fail** (a branch git couldn't make, the agent
  busy): `_app` has no place for it, so the app answers with the app and
  says why in `notice?`.
