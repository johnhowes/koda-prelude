# Design System Page - notes

The design system read outside a design session, as the Architecture design's
pages read the architecture: `/f/:folder/system`, linked from the project
page's Reference card (R-x4b in Project Landing Page).

Made by the fix "I added support for a project's architecture view…"
(prelude/fixes/i-added-support-for-a-project-s-architecture-view-a,
2026-10-22): `/f/:project/system` had been a redirect to the gallery's first
screen, bare on the preview origin. A design of kind `system` can't make this
page itself: it is always plain screens (its gallery), with no routes.

## The page (built: `server/views/system/page.eta`, `server/system.js`)

- The bar and crumbs, the design system's title, and "Change it with the
  agent", which opens its design, as Architecture's does.
- **The gallery, framed**: the same screens the design session shows, on the
  preview origin (they're the agent's HTML), in a card that takes the
  window's height less the heading; the gallery scrolls inside it.
- **A segmented control picks a screen** (`?screen=`) when the gallery has
  more than one. A gallery whose screens link each other (Prelude's do) has
  its own as well; the control is there for those that don't.
- **Read, not shown** (R-n6f): the frame is served from `/f/<folder>/r/`, the
  preview's files to read, so following a link in it doesn't move the
  session's screen as `/p/` does.
- **Empty**: no design system ("Design it with the agent…" opens New design
  with `?kind=system`), or one with no gallery yet (it opens its design).

States: `01-typical`, `02-nothing-yet`, `03-no-system`. The states' frame is
`about:blank`: the gallery is a design's files, which the design host doesn't
serve.

## Open questions

- Prelude's gallery has its own Tokens / Components / Guidelines links, so the
  page shows the choice twice; following one in the gallery doesn't move the
  page's control. Drop the page's control when a gallery links its own
  screens, or ask the system's agent to leave the links out?
