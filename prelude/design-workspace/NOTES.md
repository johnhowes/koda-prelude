# Design Workspace - notes

A redesign of Prelude's design page (`/f/:folder/d/:design`, its sessions and
the pop-out window): today `server/views/_session.eta` (header, chat) with
`_design.eta` (the design bar and frame), `_branch.eta`, `_entry.eta`,
`_status.eta`, `_composer.eta` and `_window.eta`. It renders in the shell's
`workspace` and `window` layouts.

Nothing built yet: the first session reviewed the app's page and proposed
where it could be better (below), for the person to choose.

## What the page does today (as found, 2026-10-17)

- The header stacks crumbs, title, system/shell links, what the agent can
  read, and the whole branch block (check, behind main, app running, also
  changes, Update / Merge). It sits above a full-height workspace, so it takes
  room from both the chat and the surface.
- The design bar holds a dozen controls in one row: Design/App, page, state,
  Send event, Reset data, a page count, Approve, a notice, Refresh, Open in
  browser, Pop out.
- Only titled routes without `:params` can be picked; a detail page or an
  overlay over one is reachable only by clicking through in the frame.
- The check's results (pages that don't render, pages that differ) are lines
  in the chat, naming pages without a way to show them.
- The design's rules (RULES.md) and its notes' decisions and open questions
  aren't on the page at all.
- The status line says "Working…" and no more.

## Open questions

- Which of the proposed improvements to take on, and in what order.
