# Project Landing Page - notes

A project's own page (`/f/<id>`), a redesign of `server/views/_folder.eta` (with
`_branch.eta`), whose model is built in `server/main.js` (`view()` in the
`/f/:id` handler). Home (prelude/landing-page) gathers what needs the person
across projects and links here; this page holds the project's whole picture.

Pages: `/f/:project` (Project), `/f/:project/designs/new` (New design, modal),
`/f/:project/branches/:branch/publish` (Push a branch, modal). Fragments:
`/f/:project/work`, `/f/:project/app`. States: typical (spark-lending), new
project, app being built, update clashed (with the app on the shell's branch
and a failed push), long names (an existing app to connect, no remote).

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

- New GET routes: `/f/:id/work`, `/f/:id/app` (fragments), `/f/:id/designs/new`
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

## Also decided

- **Finishing a branch stays on this page**, as well as on the design's (the
  person had no strong view, 2026-10-18): it's where every branch is seen
  together.

## Open questions

(none)
