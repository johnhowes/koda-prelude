# Prelude Shell - notes

Prelude's own app shell: the layouts Prelude's pages render in. Drafted from
what Prelude ships (`server/views/layout.eta`, the `.bar`/`.page`/`.workspace`
rules in `server/public/prelude.css`, and the pop-out `_window.eta`), on the
Prelude Design System. Gallery: `/gallery` (with `/drawer`, `/modal`,
`/notice` over it), `/gallery/workspace`, `/gallery/window`.

## Layouts

- **app** - the bar, then the page scrolling with the window. Pages hold their
  own width (`.center`); the shell gives the room above and below. Folders, a
  folder, Build.
- **workspace** - the bar, then the page filling the rest of the window; the
  window doesn't scroll, the page's panels do. A design's page (chat + surface).
- **window** - no bar; the page fills the window. The pop-out design surface.

Shared parts in `layouts/` (`_head`, `_bar`, `_agents`, `_regions`), since a layout's
includes resolve from there. Chrome CSS is `layouts/shell.css`, all in the
`host` layer, styling only `.shell-*`. `styles.css` is the gallery's alone.

## Decisions

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
  are the platform's, and pages still just aim at `modal?`.
- **Bar: brand, what the agent is working on, and a Folders menu** (recent
  folders, then "Open a folder…"). Where you are stays the page's crumbs, since
  the bar isn't swapped on navigation and can't follow the page. Following a
  link in a bar menu closes it (`ko-set="….open = false"`).
- **What the agent is working on** (`it.layout.agents`: design, folder, url):
  the turns running anywhere, as one link, or a menu when several. Nothing when
  the agent is idle. It's the `#agents` region, so the app can push it afresh
  on its live channel (`<div ko-into="agents">`) as turns start and end; the
  design shows it from the layout's data, since a design's origin has no such
  channel.
- **`[data-desktop-only]`** moved from `prelude.css` into the shell: it's about
  the window, not a page. The app's layout still needs `desktop.js`.
- **Main region is `#main`** (was `#workspace`); nothing targets it by id.

## Open questions

- A bar menu doesn't close on a click outside it (it's a `details`); a
  `popover` would, but isn't the system's menu.
- Should the agent's status also show a turn that finished while the person
  was elsewhere (or one waiting on an approval)? Today it's only running turns.
- The modal's accessible name is a generic "Question"; the fragment can't name
  it without an id the shell knows.
- Design system lacks: a drawer/overlay surface token or component (the shell
  builds it from `--surface-raised`, `--shadow-lg`, `--backdrop`), and a width
  for a drawer (uses `--measure-narrow`).
