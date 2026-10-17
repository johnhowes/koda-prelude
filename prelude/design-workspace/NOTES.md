# Design Workspace - notes

A redesign of Prelude's design page (`/f/:folder/d/:design`, its sessions and
the pop-out window): today `server/views/_session.eta`, `_design.eta`,
`_branch.eta`, `_entry.eta`, `_status.eta`, `_composer.eta`, `_window.eta`.
It renders in the shell's `workspace` and `window` layouts. The routes carry
`"from": "@app/server/views/…"`, so the build ports it back.

Pages: Design page, About the design (drawer), Pop-out window. The fake
project is a lender's borrower portal, so sizes (phone, tablet) and a second
client (its mobile app) mean something. States: typical, pages differ,
doesn't render, building, new design, update clashed, popped out.

## Decisions

- **Scope: 1-3 of the review, plus the pop-out** (the person, 2026-10-17):
  the header, the design bar, and check results that lead somewhere.
- **A one-line header.** Crumbs and title, then the branch as one button
  with pills for what to act on (check, behind main, a clash). It opens a
  drawer (`/about`) with the branch in full and its actions, what the design
  uses, and what the agent can read. An update that clashed also shows as a
  notice above the work, since it holds the branch.
- **The chat owns its toolbar**: sessions menu, Show Agent/Tools, New
  session. A build session says so in a notice at the top of the chat.
- **The design bar reads "what am I looking at", then "how"**: Design/App,
  page (Refresh and Open in browser moved into its menu, since they act on
  the page), state, Send event, Reset data; then size, client, Pop out.
- **Review strip under the bar** (a `.notice`, edge to edge), only when
  there's something to do: a page that doesn't render, pages that differ
  (with Approve again), or none approved yet. Its menu lists the pages;
  each shows that page in the state the check named. The chat's check
  entries have Show beside each page too. The page count is gone.
- **Size and client are not states** (the person asked, 2026-10-17). States
  are data; size and client are how one window looks at it. They're per
  window (in the surface's URL, like Design/App), so the pop-out can show a
  phone while the panel fits. Page and state stay shared, as today.
- **Sizes**: Fit the panel (default), then fixed sizes, then Custom (width
  and height fields, 200-4000 px; the person, 2026-10-17). One size at a
  time, not several side by side (the person, 2026-10-17). The custom size
  is remembered for the design (the person, 2026-10-17): one, replaced
  when another is set, listed after the shell's sizes in every window
  (`POST …/size`); which size a window shows stays its own. At a size the
  frame keeps that shape, scaled down to fit (container units in the
  design; the app's iframe needs a transform from its measured size).
- **Sizes and clients are declared by the app shell** (the person agreed,
  2026-10-17): `prelude-shell/clients.json`, the same for every design.
  Prelude's: Small window, Laptop, Desktop; Browser and Desktop app. The
  states here show a borrower portal's own (Phone, Tablet; its mobile app),
  as its shell would declare them.
- **Clients**: what the page runs in. The desktop app's whole difference is
  a root attribute (`data-desktop`, which shows `[data-desktop-only]`) plus
  native windows and the system browser. So a client is attributes on the
  previewed page's root, and words saying what else differs; Prelude can't
  run the client. For Prelude's own design page the desktop app changes
  nothing visible; it matters for Landing Page's Open a project (Choose…).
- **The design's forms post dotted fields** (`surface.current`,
  `surface.state`) so the preview works; the app posts `screen` and `state`.
  The composer posts hidden `type` and `action` for the same reason: a
  refused message re-renders from the posted fields alone, so the form must
  carry its own action. The app's composer posts only `message`. Starting
  a session is an `update` of the design in the design, so its refusal
  re-renders with the design's data.

## Open questions

- In the preview, session links, New session and the branch actions lead
  nowhere (the design shows one session at the design's URL).
- Not taken on yet from the review: rules and open questions on the page,
  a fuller status line, suggestions for a new session.
