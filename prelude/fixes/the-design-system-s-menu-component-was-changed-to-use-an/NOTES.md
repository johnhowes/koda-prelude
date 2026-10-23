# Fix: The design system's menu component was changed to use an…

What's wrong, the cause, what changed, and what to check - written as the fix goes.

## The problem

The design system's menu (`prelude/prelude-design-system/system/components/menu.html`)
became a popover on 2026-10-23: a button with `popovertarget` and a
`.menu-list popover`, anchored with CSS anchor positioning. The design
system's session warned that the app's menus were still `<details>`, and
that `desktop.js` closed Capture's menu by finding a `details`.

## The cause

The app doesn't keep a copy of the system: `/system/` is served straight from
`prelude/prelude-design-system/system/` (`server/main.js`, `systemDir`), and
every page on the system links `/system/components.css` (`_head.eta`). So once
the system's change was merged, the app already had the new CSS. That CSS
places only a `.menu-list[popover]`, so the app's `details` menus lost their
placing and opened in the flow of their bar or panel.

There were 11 such menus, not 13: five in `_design-bar.eta` (state, Send
event, Capture, size, client), `_page-menu`, `_review-menu` (shown twice in
the bar), `_chat` (sessions), `_dictation` (speech model), `_bar`
(Projects) and `_agents` (several turns). The shell design's `_bar` and
`_agents` were the same. Besides `desktop.js`, five rows closed their menu
with `ko-set="….open = false"`, which a popover hasn't got.

## The change

- Each menu is the system's markup: `<div class="menu …">`, a
  `<button type="button" popovertarget ko-for="…">`, and the `.menu-list`
  with `ko-as="…"` and `popover` (Koda writes the ids). The two review menus
  are each a `ko-item`, so each button finds its own list.
- A popover closes on a click outside or Escape, but not when a row in it is
  pressed, and in Prelude a row never leaves the page (Koda swaps the main
  region, or sends a form whose answer may land beside the menu: Send event,
  Capture). So `_regions.eta` (the app's and the shell design's) closes the
  menu a row was pressed in, for every menu. A form's own `.btn` (Use this
  size) isn't a row: its form decides. This replaces the `ko-set`s.
- `desktop.js`: What's in view finds its menu with `closest('[popover]')` and
  closes it with `hidePopover()`. It stops the click, so the layout's
  closing never hears it.
- Notes: Design Workspace, Build, Prelude Shell and the design system say
  what changed. The shell's open question (a bar menu not closing on a click
  outside) is answered, so it's gone.
- Tests: `test/events.test.js` and `test/host.test.js` match the new button;
  `test/menus.test.js` (new) checks that no view or shell layout has a
  `details` menu or a `.open = false`, that every `.menu-list` is a named
  popover with a button for it, and that `desktop.js` closes Capture's menu as a
  popover.

## What to check

- Run `npm test` (or `node --test test/menus.test.js test/events.test.js test/host.test.js`).
- On a design's page: each menu in the design bar opens floating below its
  button (state, page, Capture, Send event open from their left edge), is
  drawn over the frame, and closes on a click outside, on Escape, and when a
  row is pressed. Send event's and Capture's rows now close their menu
  (Send event's used to stay open).
- The size menu: typing a custom size and pressing Use this size works, and
  the menu doesn't close while you type.
- The speech model menu opens upwards; Change model… opens the modal and the
  menu is gone.
- In the desktop app, Capture → What's in view: the menu isn't in the picture.
- The pages that show these menus will differ from their approved screens
  (Design Workspace, Build, Fix Something, Project Landing Page, Landing Page,
  Architecture): the markup changed on purpose. Approve them again if they
  look right.
