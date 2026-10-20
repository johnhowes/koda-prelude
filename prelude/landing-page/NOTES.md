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
- **Regions refresh on events, with a slow poll behind** (the person,
  2026-10-16). The shell's layout holds one live channel per page
  (`it.layout.live`); the server sends `needs-changed` and `projects-changed`
  as turns, builds and pushes change things, and each region reloads on its
  event (`ko-invoke="event:…"`). Every 5 minutes as well, for what Prelude
  can't see (a pull request merged on the Git server). Polling every 30s was
  dropped: each refresh reads every project's branches. The projects also
  reload on `needs-changed`, since each card counts what's waiting in it.
  `events.json` declares both for the preview's design bar. `needs-changed`
  adds a question (it works in every state, any number of times);
  `projects-changed` names borrower-portal, so it works where that project
  exists (typical, all caught up).
- **Needs are kept oldest first, shown newest first**: the data keeps them in
  the order they arrived, as an added one lands at the end, and the view
  shows them from the end.
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
- **States set the bar's data** (`"layout"` in a state overrides the shell's
  `layouts/app.json`), so the bar's count and Projects menu agree with the page.
- **Times are prepared strings** ("4 minutes ago") in the data, as the app
  prepares data before rendering.

## Built (2026-10-17)

`/`, `/home/needs-you`, `/home/projects`, `/open` and both forms are the app's
own: `server/views/home/`, answered in `server/main.js`, the model read in
`server/home.js` (its typedefs are the states' shape).

`/loading` was built 2026-10-19: `server/views/home/loading.eta`, answered
like `/` (the names-only model, in the app's layout) but with its regions
never asked to load. The app needs no such URL; it's there so the design's
route has the app's view behind it, and shows the first paint on its own.
R-5ja was already true of `/`, which renders before any project is read.

- **What counts as waiting**, read from each project's sessions and branches
  each time: a *question* is the newest session's last turn ending in "?" (the
  agent has no way to say it's asking; this is a heuristic). A *finished* turn
  stays until its session is opened, or a week; opening is remembered on this
  machine (`~/.prelude/seen.json`), and a turn that ends while its session is on
  screen counts as opened. *Build stopped* is a branch building a group with no
  turn running. *Ready to build* is an approved design with unbuilt groups, once
  the app exists. A *pull request* is a pushed branch, until it's merged; the
  home page's regions fetch and tidy a project with one (every 30 seconds at
  most), which is how a merge on the Git server is found.
- **"Last changed"** is the newest of a project's sessions, branches, pushes
  and designs; when none, when it was last opened. A folder that's gone is
  listed last.
- **Opening a project goes to its page** (303 to `/f/<id>`), which lands in the
  workspace; the app's layout closes the modal when the workspace moves.
  Removing a project without script redirects home.
- **A region Prelude can't read** answers 503 without `x-koda`, so Koda keeps
  the region, marks it unreachable and the page's Try again appears.
- **The app's layout** (`server/views/layout.eta`) gained what this page asks
  of the shell, as little as it could: the modal region, the bar's count
  (`#waiting`, `server/views/_waiting.eta`) and the app's live channel
  (`/live`, `it.layout.live`). `needs-changed` and `projects-changed` are sent
  as turns start and end, sessions are opened, designs are made or approved,
  branches are pushed, merged or updated, and projects are opened or removed;
  `needs-changed` also pushes the bar's count.
- **The design system**: Home is written in it, and the rest of the app is
  still on ds/v1, so the app serves the system at `/system/` (from
  `prelude/prelude-design-system/system`) and the home pages link it instead
  of ds/v1. `prelude.css` still applies on top.

Home's window title was built 2026-10-19 (story `home/1`): `homePage` in
`server/main.js` titles `/` "Home", as routes.json does, and so does the page
re-rendered for a refused `POST /folders` without script, and the redirect home
after removing a project. `/loading` and `/open` keep "Prelude" in the app, as
the story asks, though their approved screens and routes.json title them "Home,
while it loads" and "Open a project".

- **Where the design and the story differ, or the story can't be met yet:**
  - The rendered pages show "Home · Prelude" and `/_prelude/…` stylesheets for
    every route, `/loading` and `/open` included: that's the preview's shell
    head (`prelude/prelude-shell/layouts/_head.eta`), not the app's
    (`server/views/_head.eta`), which the approved screens were taken from. Not
    a change to Home.
  - "Coming back to Home from a project's page, the window's title changes back
    to Home" holds when Home is loaded whole, not when Koda swaps it into the
    page from the brand link or Needs you: Koda has no way to set the
    document's title on a swap, and none of the app's titled pages update it
    either. That needs a change to Koda or to the app's layout, for every page.

## Needs you, only what needs acting on (fix, 2026-10-19)

The list had become noise: a row for every unopened session of the week, and
for every pull request and design ready to build. It now holds only a
question, a stopped build and a turn that ended with an error (the person's
decision, replacing 2026-10-16's "includes finished turns"). Pull requests,
pages to build and finished turns are still said in each card's In progress
line, and on the project's page; the bar and each card count only what's
listed. Typical's state lost those rows, and Document upload's is now an
error. `server/home.js` (`needsYou`) decides; R-n4v, R-8hc, R-w2k changed.

## Projects, only projects (fix, 2026-10-20)

The list showed branch worktrees (`~/.prelude/worktrees/<id>/<branch>`) as
projects, some "gone" once merged. They get into the recent list when opened
as a plain folder (as step 8 builds did); `app.folders.recent()` doesn't
leave them out. The views and states were already right; R-c7w (proposed)
says it, and the build should filter worktrees out of `recent()` (or of
`server/home.js`'s list) and drop such records.

Built 2026-10-20: `server/folders.js` treats any folder under
`~/.prelude/worktrees/` as a design's worktree. Reading the recent list drops
such records (gone or not), and `open()` never adds one: a worktree's own page
no longer puts it on the list, and `POST /folders` with a worktree's path opens
the repository it belongs to (`repositoryOf` in `server/branches.js`), so the
person lands on the project, whose card shows the branch's work. A worktree
git no longer knows (its project unknown) is refused in the modal, in the
form's own error. No view, state or route changed. The story (`home/1`) is
about the window's title, unaffected.

## Open questions

- In the preview the bar's count doesn't follow an event: it comes from the
  layout's data, and pushing it would need a copy of the shell's partial in
  this design. The app would push `#waiting` itself.
- Should `projects-changed` name the project, so only its card reloads?
  Worth it only if reading all of them proves slow.
