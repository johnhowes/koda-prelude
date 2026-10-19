# Fix Something - notes

A UX redesign of step 11's Fix (docs/plan.md): starting one, its page, and
how it's listed. It also lets you just ask a question about the project.

Before this design: "Fix something…" on the project page opened a modal
(`server/views/projects/_new-fix.eta`, `_new-fix-fields.eta`) that asked for
a title and a first message. Posting made the branch, the fix's folder and
its first session (`POST /f/:id/fixes`).

## Review (2026-10-19)

1. You had to name the problem before describing it, and the name was the
   branch's.
2. The modal's message box was weaker than the chat's: no images, paste,
   capture or dictation.
3. A branch was made before anything was known, so a question left a branch
   behind ("Nothing done on it yet").
4. You couldn't just ask a question about the project.
5. The button was hidden on a project with no designs.

## Decisions

- **One conversation that becomes a fix** (the person, 2026-10-19). "Ask or
  fix…" opens a page with the full chat. The agent only reads (R-h7w).
  "Fix it on a branch…" in the header asks first in a modal, then makes the
  branch. The same conversation carries on as the fix's (R-x8d). One entry,
  not two buttons.
- **A question is a Fix without its branch yet** (the person, 2026-10-19).
  It isn't a sixth noun. Its id is `fixes/<slug>`, its page is the fix's,
  and it's `kind: fix` with `branch: null`.
- **Kept on this computer** (the person, 2026-10-19), like drafts, until it
  has a branch (R-2qz). Its sessions move into `prelude/fixes/<slug>/` when
  the branch is made.
- **No title to write.** It's named from the first message (R-m5c). The name
  is asked for only by Fix it on a branch, starting from that one, because a
  branch needs a name. Rename (the icon beside the title) works on a branch
  or off, and the branch keeps its name (R-j3v).
- **Ask or fix… is on every project**, even one with no designs (R-k9p).
  It's a plain button: New design stays the one primary. The first-run page
  links to it too.
- **Asked lately** is a card in the project's work region, after In
  progress. It lists conversations with no branch, newest first, each
  marked Working or Asking you, with the agent's last line.
- **The new conversation's page** is `/f/:project/d/fixes/new` (it replaces
  the modal at `/f/:id/fixes/new`). It starts from what Prelude knows is
  wrong in the project (`troubles`: a stopped build, a branch whose pages
  don't render), then "Ask how something works" and "Say what's wrong, with
  a screenshot".
- **The chat keeps a readable width** (`--measure`) on a conversation's
  page, since there's no design surface beside it. It's in `styles.css`.
- **No "what you're looking at" chip** on a fix's message box, because
  there's no page on show. The app's fix page shows one today.

## What building it changes in the app

- New routes: `/f/:id/d/fixes/new` (the page), and its first message
  `POST …/fixes/new/sessions`. This makes the question's local record and
  its session. `fixes/new` is reserved as a slug. The modal
  (`_new-fix*.eta`) and `POST /f/:id/fixes` go.
- `GET/POST …/d/fixes/:fix/branch`: makes the branch and worktree, moves
  the sessions into the fix's folder, commits, and redirects to the
  worktree's fix page. `GET/POST …/rename`.
- A question's agent runs read-only: `permissionArgs` in mode `fix` with no
  branch allows no writes. `fixPrompt` says it only reads, and should end
  with what it would change.
- Model: the project gains `asked`, and the fix page gains `troubles`.
- `_message-box` takes a `placeholder`.

## Built: the project's page (2026-10-19)

- `projects/page` and `projects/_work` are ported over
  `server/views/projects/page.eta` and `_work.eta`, as designed.
- The conversations with no branch are kept in
  `<home>/asked/<project>/<slug>/` (`server/asked.js`): `fix.json` and
  `sessions/`, laid out like a fix's folder, so they're never in the project
  (R-2qz). `askedOf` (`server/project.js`) makes the page's `asked` from
  them, newest first. A conversation is Working while a turn runs, Asking you
  when its last turn ended on a question (the same test Needs you uses), and
  answered otherwise. One whose `fixes/<slug>` has a branch is left out, so
  it's In progress only.
- `app.asked.moveOnto(folder, slug, worktreePath, { title })` moves a
  conversation's sessions into `prelude/fixes/<slug>/` on its branch and
  stops keeping it here. `create` and `rename` are there for the
  conversation's pages too.
- Still to build, with the conversation's pages (`/f/:project/d/fixes/…`,
  not this group): the routes that use the store. `POST …/fixes/new/sessions`
  calls `create`. `POST …/d/fixes/:fix/branch` makes the branch
  (`prelude/fix-<slug>`), calls `moveOnto` and commits. The design page's
  lookup has to find a conversation in the store when it has no branch. The
  old modal (`_new-fix*.eta`, `GET /fixes/new`, `POST /fixes`) is still in
  `server/main.js` until then, but nothing links to it now. So R-x8d and
  R-2qz stay proposed: what this page shows of them is true, but no route
  makes, or branches, a conversation yet.
- Until then, the Ask or fix… links on this page go to
  `/f/:project/d/fixes/new`, which the app doesn't answer yet.

## Open questions

- How long does a question stay in Asked lately: a number of them, or 30
  days untouched? And can the person remove one?
- In a project that isn't a Git repository, Fix it on a branch makes it one
  first. Should the modal say so? The page's model doesn't say whether the
  project is a repository.
- In the preview, the first message of Ask or fix lands on the sample
  question that's working, not a new one: the fake route can't make the
  page's model. The branch's About drawer and New session lead nowhere.
