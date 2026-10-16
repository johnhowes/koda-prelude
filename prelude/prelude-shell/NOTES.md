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

Shared parts in `layouts/` (`_head`, `_bar`, `_regions`), since a layout's
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
- **Modal is a CSS overlay, not `<dialog>`.** Koda doesn't call `showModal()`
  when content lands in a region, so a dialog region would never open.
- **Bar: brand + a Folders menu** (recent folders, then "Open a folder…").
  Where you are stays the page's crumbs, since the bar isn't swapped on
  navigation and can't follow the page.
- **`[data-desktop-only]`** moved from `prelude.css` into the shell: it's about
  the window, not a page. The app's layout still needs `desktop.js`.
- **Main region is `#main`** (was `#workspace`); nothing targets it by id.

## Open questions

- The modal has no focus trap or Escape, and the page beneath isn't inert,
  without script. Is that acceptable for Prelude's rare questions, or should
  the modal go (the design system's notes already ask whether it's needed)?
- The Folders menu (`details`) stays open after following a link in it, since
  the bar isn't swapped. A `popover` would light-dismiss but isn't the system's
  menu.
- Should the bar show the agent's status across pages (a turn running on
  another design)?
- Design system lacks: a drawer/overlay surface token or component (the shell
  builds it from `--surface-raised`, `--shadow-lg`, `--backdrop`), and a width
  for a drawer (uses `--measure-narrow`).
