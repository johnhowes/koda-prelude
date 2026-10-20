# Fix: Requests seem to take a very long time, even for things…

What's wrong, the cause, what changed, and what to check - written as the fix goes.

## The problem

Pages that should be quick are slow: a project's page, and opening Push and
open a pull request… in its modal. Pressing a link or button showed nothing
while it waited, so a slow answer looked like a press that didn't take.

## The cause

Git runs synchronously in the server (`execFileSync`), so every git call holds
up every request, not only its own. A project's page made a lot of them, all
over again on every load:

- **One `git show` per file** of each branch's design as it was where the
  branch left main (`incrementOf`, server/increment.js), for the branch's
  stories: every view, state and approved screen - 30 to 60 files a design.
  On Windows each process costs tens of milliseconds. The biggest cost.
- **`branches.status` ~8 git calls**, twice per branch (`branchState` and
  `groupsOf`), plus a `git log` per group (`designCommitsSince`).
- **The work region reloads on every turn starting or ending**
  (`needs-changed`, `projects-changed`) and did all of this again each time,
  so while the agent worked, Prelude kept stalling.
- **Push's modal worked out every branch, stories and all**, to find its one
  (`branchNow` in server/main.js), and uses neither the others nor the stories.
- **`git fetch` from the remote ran inside the request** (`tidyFolder`, at
  most every 30s per project): a network call that blocked everything.

The design system marked busy controls only as `button[ko-busy]` at 0.7
opacity, so links styled as buttons, icon buttons and links showed nothing.

## The change

Speed (server/branches.js, server/increment.js, server/main.js, server/project.js):

- `textsOf(repo, ids)` reads any number of blobs in one `git cat-file --batch`;
  `incrementOf` reads the whole baseline (less its sessions) with it.
- Kept by ids, so never stale: blob texts, `filesAt` trees at a commit, and
  `designCommitsSince` between two commits. `status` reads the branch's, main's
  and origin's main's commits in one `for-each-ref`, and keeps its answer
  while none of them moves; it now returns the branch's `tip`, which `groupsOf`
  passes on, and `groupsOf` no longer works out the status twice.
- `branchesOf` takes `only`: Push's modal reads its own branch, without stories.
- `tidyFolder` fetches with `fetchRemote` (async), then tidies; anything tidied
  is told down the channel, so the page's regions reload. A local merge still
  tidies at once (`fetch: false`), so its answer has the branch gone.

Loading states (prelude/prelude-design-system, copied into server/public/ds/v1):

- `[ko-busy]` on a `.btn` or `.link-btn` shows a small spinner beside its
  words after 150ms (`--delay-busy`), so a quick answer doesn't flicker; an
  `.icon-btn`'s glyph pulses, and any other link pulses; the cursor is
  `progress`. Koda sets `ko-busy` on whatever was pressed until it's answered,
  so no page needed changing. Guideline 12 says so; button.html,
  icon-button.html and the gallery show it.
- `ko-defer` wasn't needed anywhere once the answers are quick.

## What to check

- Run `npm test`, in particular `test/branches.test.js` (new: blobs read in
  one go, status follows a branch as it moves), `test/increment.test.js`,
  `test/build.test.js` (its remote test now waits for the tidy that follows
  the page), `test/app.test.js` and `test/fixes.test.js`.
- Open a project with a few branches and reload it twice: the second load
  should be quick. Open Push and open a pull request…: the modal should come
  up at once, and the link should show a spinner if it doesn't.
- With an agent working, the page should stay responsive.
- A pull request merged on the Git server now leaves In progress a moment
  after the project page loads, not as it loads (project-landing-page NOTES).
- Pressing any button or link while Prelude is slow: a spinner (buttons) or a
  pulse (icon buttons, links) after a moment. With reduced motion: still
  spinner ring, no pulse, and the progress cursor.
- Not changed: `branchState` still reads every session's transcript for the
  branch's last check. It's file reading, not git, but grows with history; if
  the page is still slow on a long-lived branch, that's next.
