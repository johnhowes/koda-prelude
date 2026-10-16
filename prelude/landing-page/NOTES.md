# Landing Page - notes

Prelude's home page (`/`), today `server/views/_home.eta`: an "Open a project"
form and a list of recent projects (name and path only). This design turns it
into a dashboard across the person's projects: "what needs me, and where was I?"

Pages: `/` (Home), `/loading` (Home before its regions load; the design's way
to show it, not a URL the app needs), `/open` (the modal). States: typical,
first run (no projects), all caught up, long names.

## Decisions

- **Across projects** (the person's decision, 2026-10-16). Each project's own
  page keeps its full "In progress"; home gathers the parts that need action.
- **Needs you includes finished turns and questions** (the person, 2026-10-16),
  beside "ready to build", "build stopped" and "pull request open". Each row
  links to where it's answered; a pull request opens on the Git server.
  What's running right now stays in the bar, not repeated here.
- **Projects as a grid of cards** (a handful, the person said): each with its
  in-progress designs as links, how many things are waiting on you, and a line
  of facts (designs, stack, last change).
- **Regions load separately, with skeletons** (the person asked for loading
  states). The page arrives with the recent list (cheap); Needs you
  (`/home/needs-you`) and the projects' contents (`/home/projects`) each load
  into their own region. The projects show their real names and paths at once,
  with skeletons only for what's unknown. Each region shows a retry if it
  can't be reached. Added `.skeleton` to the design system for it.
- **Open a project is a modal** (`/open`), from the Projects heading, or as the
  page's one primary button on first run. The real app opens the new project's
  page; the design closes the modal and refreshes home.
- **Regions refresh every 30s** (the person, 2026-10-16) with Koda's polling,
  which pauses in a hidden tab. A live channel push would do as well later.
- **A project whose folder has gone** stays as a card saying so, with "Remove
  from your projects" (`POST /folders/:id/remove`) (the person, 2026-10-16).
- **The bar counts what needs you** (the person, 2026-10-16): a shell change,
  `it.layout.needsYou`, a link home.
- **First run is a full-height empty page** (`.empty.page`, added to the design
  system): icon, heading, the one large primary button, and the three steps
  that follow (open, design, build), to fill the page and say what Prelude is.
- **Finished turns expire from Needs you** after a week unopened (the person
  agreed to expiry, 2026-10-16; the week is a first guess). Questions, stopped
  builds, pages to build and pull requests don't expire: they're still true.
- **Times are prepared strings** ("4 minutes ago") in the data, as the app
  prepares data before rendering.

## Open questions

- Refresh by events instead of polling? Proposed: one channel per page in the
  shell's layout (the app already streams with SSE, `server/live.js`), sending
  small events (`needs-changed`, `projects-changed`) that regions reload on,
  plus a slow poll for what Prelude can't see happen (a pull request merged
  on the Git server). Waiting on the person.
