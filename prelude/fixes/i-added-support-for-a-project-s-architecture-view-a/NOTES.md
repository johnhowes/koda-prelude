# Fix: reading the design system, and finding where to draft the architecture

## The problem

- The project page's Reference card links the design system to
  `/f/:project/system`, which didn't open a page: it redirected to the
  gallery's first screen, bare, on the preview origin (no bar, no crumbs, no
  way back). The person wanted a view-only page, as the architecture has.
- There was no way to find where to draft a project's architecture. The
  Reference card shows Architecture only once parts are written, and New
  design never offered it as a kind, so the only way in was typing
  `/f/:project/architecture` and pressing "Draft it from the code…".

## The cause

- `/f/:project/system` was a stopgap redirect (`server/main.js`), left until
  "the Prelude Design System design gives it a page of its own"
  (prelude/project-landing-page/NOTES.md). A design of kind `system` can't do
  that: it is always plain screens (its gallery), with no routes or views.
- New design's kinds (`server/views/projects/_new-design.eta`) were design,
  system and shell; architecture was offered only through `?kind=architecture`,
  from the Architecture page's empty state.

## The change

- **A Design System page in the app**, `/f/:project/system`, as the
  Architecture pages are: the bar, crumbs, the design system's title, "Change
  it with the agent", and its gallery in a frame (on the preview origin, as
  every screen is, so the agent's HTML can't reach Prelude's pages). When the
  gallery has more than one screen, a segmented control picks one
  (`?screen=`). With no design system, or nothing in its gallery yet, the page
  says so and offers the way to make it.
  - `server/system.js` (`systemOf`): the page's model. It finds the system in
    main, or on its own branch while it's only there, as the redirect did.
  - `server/views/system/page.eta`, and its rules in `server/public/prelude.css`.
  - `server/main.js`: the route, and `/f/:id/system` joins the app layout.
  - The preview origin also serves the designs' files at `/f/<folder>/r/…`,
    to read: the page frames the gallery from there, so following a link in
    it doesn't move the screen an open design-system session shows, as
    `/p/…` does.
  - Designed in a new design, **Design System Page**
    (`prelude/design-system-page`), whose route is the app's view (`@app/`),
    with three states.
- **New design offers "The project’s architecture"** as a kind while the
  project has none, as it does the design system and the shell
  (prelude/project-landing-page: R-wm3 and the view changed, NOTES says why).

- **An architecture session shows the Architecture page beside the chat**,
  as a design-system session shows its gallery (the person, second turn: "it
  would behave similarly to designing a design system"). Before, its design
  surface was empty, and its prompt said "There is no screen, view or state
  to make", without saying where the person sees what's written.
  - `server/main.js` (`surfaceOf`): an architecture design's one page is
    Prelude's `/f/<folder>/architecture`, for the session's folder, once
    overview.md is written; Capture opens it with `?framed=1`.
  - Framed (`sec-fetch-dest: iframe`, or `?framed=1`), the page leaves out
    the bar (`bare`, in `layout.eta` and `shaped`), the crumbs and "Change it
    with the agent" (`overview.eta`).
  - `_surface.eta`: "Nothing written yet…" before the overview is.
  - `server/agent.js` (`architectureSection`): the agent is told the person
    watches the page beside the chat, and to write the overview first.
  - Notes in prelude/architecture and prelude/design-workspace.

## Not changed

- The design system's gallery itself, and the design session for it.

## What to check

- On Prelude's project page, Reference → Prelude Design System opens a page
  in the app with the gallery framed; Tokens, Components and Guidelines switch
  it; "Change it with the agent" opens the design. Light and dark both.
- New design (on a project without an architecture) offers "The project’s
  architecture"; creating it opens its design page, whose surface says
  nothing's written yet. Ask the agent to draft it: once overview.md is
  written, the bar offers Load changes, and the Architecture page shows
  beside the chat, without Prelude's bar.
- In the desktop app too: the frame relies on `sec-fetch-dest: iframe` to
  leave the bar out.
- Prelude's gallery has its own Tokens / Components / Guidelines links, so
  the page shows that choice twice (an open question in Design System Page's
  NOTES).
- Run the tests: `node --test test/system-page.test.js test/preview.test.js test/system.test.js test/architecture.test.js`
  (and the whole suite, `npm test`).
- Snapshots that will differ on purpose: Project Landing Page's
  `new-project` New design modal (the new kind).
