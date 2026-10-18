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
- **One live channel per page** (`it.layout.live`, a URL; `_regions.eta`): a
  hidden `ko-connect` in every layout when the app gives one. It carries named
  events pages reload on (`needs-changed`) and markup for the bar's regions
  (`ko-into="waiting"`, `"agents"`). Left out when there's no URL, as on a
  design's origin. Added for "Landing Page" (prelude/landing-page). Today the
  app opens channels only on session and window pages (`server/live.js`).
- **`[data-desktop-only]`** moved from `prelude.css` into the shell: it's about
  the window, not a page. The app's layout still needs `desktop.js`.
- **Main region is `#main`** (was `#workspace`); nothing targets it by id.
- **A wide modal**: a modal fragment whose root has `.modal-wide` gets the
  reading width (`--measure`) instead of the narrow one, for something to
  look at (an image). Gallery: `/gallery/modal-wide`. Added for "Design
  Workspace" (prelude/design-workspace): a sent image, full size.
- **Sizes and clients** (`clients.json`): what a design's preview offers
  besides Fit the panel, the same for every design. A size is a title and
  width × height; a client is a title, a line saying what differs, and the
  attributes it sets on the page's root (the desktop app sets
  `data-desktop`, which shows `[data-desktop-only]`). Prelude can't run a
  client; these show what the page itself shows in it. Added for "Design
  Workspace" (prelude/design-workspace).

## Connected to the app (2026-10-16)

The app is Prelude's own server (`server/`: Node, node:http, Eta and Koda).
Its views are plain Eta with no helpers of its own (data such as an entry's
`html` is prepared before rendering), so Prelude renders them itself: no
design host.

## Built into the app (2026-10-17)

The three layouts are the app's now, named in `layouts.json`:

- **app** → `server/views/layout.eta` (the app's main layout, redesigned).
- **workspace** → `server/views/workspace-layout.eta` (the design page's,
  redesigned; it already had most of it).
- **window** → `server/views/window-layout.eta` (new). The pop-out used to be
  `workspace-layout` with `bare: true`; the two pop-out routes in `main.js`
  (`…/preview`, `…/window`) now render `window-layout`, and give their live
  channel as `layout.live` instead of `live`. Nothing passes `bare` any more.

The partials are in `server/views/`: `_head`, `_bar`, `_agents`, `_regions`,
and the app's own `_waiting` (the same element; `home.js` pushes it down the
channel). The chrome is `server/public/shell.css` (the shell's `shell.css`,
unchanged), linked at `/static/shell.css`, so the app no longer reads it from
this folder (`/shell/`). `styles.css` isn't ported: it's the gallery's
placeholders, not the layouts'.

What changed from the design, because real code requires it:

- **URLs**: the app's own: `/system/…` (Prelude's design system), `/ds/v1/…`,
  `/static/shell.css`, `/static/<page>.css`, `/koda/koda.js`, plus the app's
  icon. The design's `/_prelude/design/styles.css` is the page's own
  stylesheet in the app: `prelude.css` on app, `workspace.css` on workspace
  and window. `prelude/prelude.json` now names those folders (`app.assets`),
  so a design's origin serves them at the same paths when it renders a design
  in the app's layouts.
- **Data**: the location is `it.path` (the app passes `path`; the design
  host passes both). The title is the app's whole title (`it.title ??
  'Prelude'`), since the app's titles already end in what they are.
- **`desktop.js`** is loaded by `_regions`, before Koda starts.

What `layout.eta` kept, and why:

- **The main region's id, `#workspace`** (the design says `#main`): asked to
  keep it. Nothing targets it by id. The workspace and window layouts were
  already `#main`.
- **`.prelude` on the root** (now the `<body>`, beside `.shell`, instead of a
  wrapping `div`): `prelude.css` scopes every page rule to it, and
  `desktop.js` marks it with `data-desktop`.
- **`system`**: pages not yet ported from a design are written in ds/v1, so
  `_head` links ds/v1's components for them. It links Prelude's
  `tokens.css` first in every layout: the shell's chrome is drawn with tokens
  ds/v1 hasn't got (`--border-width`, `--measure-narrow`, `--control-sm`,
  `--leading`, `--weight-heading`), and ds/v1's tokens override the rest. A
  design rendered in the layout (no `system`) gets Prelude's system.
- **The modal closes when the main region moves** (a form in it that goes to
  another page, such as Open a project). It's in `_regions` now, so every
  layout does it; it finds the main region as `body > main`.

And in `prelude.css`: the old bar, `.waiting` and `.modal-dialog` rules, and
`[data-desktop-only]`, are gone (the shell draws them). The room above and
below a page is the shell's (`.shell-main`), so `.page` keeps only its
inline padding and `main > .center`'s padding went. `home.test.js` matches
the bar's count by its new class, `shell-waiting`.

Not given yet by the app: `layout.projects` and `layout.agents`, so its bar
shows no Projects menu and no agent status (each is left out when empty);
the workspace layout is given no layout data at all, since its page opens its
own live channel. Giving them is a feature's work, not the layout's.

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
