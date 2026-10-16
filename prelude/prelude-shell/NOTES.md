# Prelude Shell - notes

Prelude's own app shell: the layouts Prelude's pages render in. Drafted from
what Prelude ships (`server/views/layout.eta`, the `.bar`/`.page`/`.workspace`
rules in `server/public/prelude.css`, and the pop-out `_window.eta`), on the
Prelude Design System. Gallery: `/gallery` (with `/drawer`, `/modal`,
`/notice` over it), `/gallery/workspace`, `/gallery/window`.

## Layouts

- **app** - the bar, then the page scrolling with the window. Pages hold their
  own width (`.center`); the shell gives the room above and below. Projects, a
  project, Build.
- **workspace** - the bar, then the page filling the rest of the window; the
  window doesn't scroll, the page's panels do. A design's page (chat + surface).
- **window** - no bar; the page fills the window. The pop-out design surface.

Shared parts in `layouts/` (`_head`, `_bar`, `_agents`, `_regions`), since a layout's
includes resolve from there. Chrome CSS is `layouts/shell.css`, all in the
`host` layer, styling only `.shell-*`. `styles.css` is the gallery's alone.

## Decisions

- **The gallery shows placeholders, not content** (Prelude's guidance,
  2026-10-16): grey `.skeleton` blocks (styles.css) wherever a page or an
  overlay puts content, so what's real on screen is the layout's. The only
  real content is the buttons that open each region. Placeholder headings keep
  a hidden name ("Sample drawer", "Sample question"), so the dialog is still
  named and the Close still lines up. States hold only layout data now.
- **"Project", not "folder"** (the person's decision, 2026-10-16), in every
  word the shell shows and in its data (`it.layout.projects`, `agents[].project`).
  URLs keep `/f/<id>`: they're the app's routes, not words. A folder the agent
  may read (not the project) is still a folder. The design system's
  guidelines.md still says "folder, not project" in its Words table: it needs
  changing there.
- **Three layouts instead of one with flags.** Today `layout.eta` takes `bare`,
  and the session page makes itself full-height with `:has(.session-page)`
  rules. Naming the layout per route says it once, and drops those rules.
- **Regions every layout offers: `notice?`, `drawer?`, `modal?`.** Notice is
  new: Prelude's one-line results ("Pushed `prelude/…`") can arrive as
  `<div ko-into="notice?">` instead of a card the page keeps. Each region is
  hidden while empty and has a Close (`--koda-empty`) in the shell's chrome, so
  the fragment needs no close of its own. Drawer and modal take focus
  (`ko-focus="region"`); the notice never steals it.
- **The modal is a real `<dialog>`, shown modal while its region holds
  something.** The region sits inside the dialog; a small script in the layout
  follows the region (`showModal()` when filled, `close()` when emptied), and
  Escape empties the region too. So the backdrop, inert page, focus and Escape
  are the platform's, and pages still just aim at `modal?`. The dialog is named
  by the first heading in it, so a modal fragment starts with an `<h2>`. The
  Close sits beside the content, centred on that heading's line, not above it.
  The drawer does the same, and sizes its `h2` as a dialog's (`--text-lg`).
- **Bar: brand, what the agent is working on, and a Projects menu** (recent
  projects, then "Open a project…"). Where you are stays the page's crumbs,
  since the bar isn't swapped on navigation and can't follow the page.
  Following a link in a bar menu closes it (`ko-set="….open = false"`).
- **What the agent is working on** (`it.layout.agents`: design, project, url):
  the turns running anywhere, as one link, or a menu when several. Nothing when
  the agent is idle. It's the `#agents` region, so the app can push it afresh
  on its live channel (`<div ko-into="agents">`) as turns start and end; the
  design shows it from the layout's data, since a design's origin has no such
  channel. The person is trying it as it is before deciding more.
- **"Needs you" in the bar** (`it.layout.needsYou`, a count): a link home with
  the number of things waiting on the person across their projects; nothing at
  zero. It's the `#waiting` region, pushed afresh like `#agents`. Added for
  "Landing Page" (prelude/landing-page), whose home lists them.
- **`[data-desktop-only]`** moved from `prelude.css` into the shell: it's about
  the window, not a page. The app's layout still needs `desktop.js`.
- **Main region is `#main`** (was `#workspace`); nothing targets it by id.

## Connected to the app (2026-10-16)

The app is Prelude's own server (`server/`: Node, node:http, Eta and Koda).
Its views are plain Eta with no helpers of its own (data such as an entry's
`html` is prepared before rendering), so Prelude renders them itself: no
design host.

- **All three layouts stay the shell's** (the person's decision, 2026-10-16):
  they're a redesign of the app's `server/views/layout.eta`, not the app's
  own, so no shell layout names an app file. The app builds them later. Today
  that one file makes all three: the window with `it.bare`, and the workspace
  through `:has(.session-page)` rules in `prelude.css`.

Where the app's layout differs from the redesign (what building it will
change):

- **No regions.** `layout.eta` prints no `notice?`, `drawer?` or `modal?`.
- **The bar** is the brand alone: no Projects menu and no agents status
  (`it.layout.projects`, `it.layout.agents` go unused).
- **The main region** is `#workspace` (the design says `#main`), and its
  location comes from `it.path` (the host passes both `path` and `location`).
- **Styles.** The layout links the app's own CSS at `/ds/v1/…` (KodaDesign's
  `packages/design/v1`, not this project's design system) and
  `/static/prelude.css`, with Koda at `/koda/koda.js`; the shell's
  `shell.css` and this project's design system aren't linked at all.
- **`desktop.js`** is loaded by the layout, as the notes above already say it
  must be.

## Open questions

- A bar menu doesn't close on a click outside it (it's a `details`); a
  `popover` would, but isn't the system's menu.
- Should the agent's status also show a turn that finished while the person
  was elsewhere (or one waiting on an approval)? Waiting to see how it feels.
- The state `02-first-folder.json` should be renamed `02-first-project.json`
  (the agent can't rename or delete files).
- Design system lacks: a skeleton placeholder (the gallery draws its own in
  styles.css; every shell's gallery will want one), a drawer/overlay surface token or component (the shell
  builds it from `--surface-raised`, `--shadow-lg`, `--backdrop`), a width
  for a drawer (uses `--measure-narrow`), and a drawer's heading size (the
  shell borrows the dialog's `--text-lg`).
