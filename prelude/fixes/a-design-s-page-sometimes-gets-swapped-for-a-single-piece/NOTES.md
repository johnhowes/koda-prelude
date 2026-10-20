# A design's page sometimes gets swapped for a single piece of it

## The problem

While typing in the message box, or after "Start with this", a design's
page is replaced by one piece of it: the whole design surface, or just the
design bar, fills the page. Seen on a new design and on a design merged into
main (so with no branch).

## The cause

`server/main.js`, the `/d/` routing. In a repository, a design with no
branch is served from the project's own address (`/f/<project>/d/…`). Any
POST made its branch first, including the draft kept while typing
(`POST …/draft`) and Start with this (`POST …/start`), which only change the
draft kept on this computer. From then on every GET at the project's address
was redirected to the worktree's (`/f/<worktree>/d/…`).

The page's regions reload from their own addresses: the surface
(`_surface.eta`, `ko-source` its preview URL) on `design-changed`, and
`#design-bar` (`…/preview/bar`) on `files-changed`. `fetch` follows the
redirect, and Koda places the answer by the address it came from
(reference.md, "Redirects"). The worktree's address is outside those
regions' scopes, so the only region that owns it is the page's own
(`#workspace`, `ko-scope="/"`; `#main` in the pop-out window), and the piece
fills the page. "Sometimes", because it needs an event after the branch was
made: the agent's work in the worktree reaches the page once its live
channel reconnects there.

## The change

- `server/main.js`, the `/d/` routing: a fragment GET (`x-koda-fragment: 1`)
  to a design with a branch is answered in place, with the worktree, as
  posts already were. Only a cold load is redirected, so the address bar
  still moves to the worktree.
- Posts that only change the draft make no branch (`changesDraftOnly`):
  keeping what's typed, the tray's images, a marked-up image, Start with
  this and answering a question.
- When another post does make the branch, the design's drafts move to the
  worktree (`app.drafts.move`): drafts are kept by folder, and Send reads
  them from the worktree.
- `prelude/design-workspace/NOTES.md`: the open question is now a decision.
  New session stays an open question (see below).

No design's views, styles, states or routes changed: pages look the same.

## New session

Probably not the same redirect. Its link (`_chat.eta`) is in `#workspace`,
whose scope is `/`, so a redirected answer still lands there. Left open in
`prelude/design-workspace/NOTES.md`: it needs reproducing (what the request
returns, and which region takes it).

## What to check

- Run `node --test test/app.test.js` (the new test: "a design with no
  branch keeps its draft without one…"), then the whole suite
  (`node --test`), especially `test/chat.test.js` and
  `test/preview.test.js`.
- In the app, open a design merged into main (no branch). Type in the box
  and use Start with this: no `prelude/<design>` branch should appear.
- Send a message (that makes the branch), and let the agent change the
  design: the surface and the bar should reload in place, and the page
  should stay whole. The draft you typed before should still be in the box
  if you hadn't sent it.
