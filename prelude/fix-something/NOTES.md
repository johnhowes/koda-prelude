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
- `app.asked.moveOnto(folder, slug, worktreePath, { title, slug })` moves a
  conversation's sessions into `prelude/fixes/<slug>/` on its branch and
  stops keeping it here.

## Built: the conversation's pages (2026-10-19)

- The design's `_header`, `_chat`, `_starters`, `_composer` and
  `_message-box` replace the app's, and `_fix-branch`, `_fix-branch-fields`,
  `_rename` and `_rename-fields` are new in `server/views/`. The centring
  rule is in `server/public/workspace.css`, where it replaces the
  `:only-child` rule.
- The project's routes send `/f/:project/d/fixes/new` and any conversation
  kept on this computer to the design page's handler (`handleDesign`), with
  the conversation as a design of kind `fix`. `fixes/new` is a conversation
  with no sessions (`app.asked.fresh`). Its first message makes the
  conversation (`create`), moves the draft over, and starts the first
  session there. The old modal's routes (`GET /f/:id/fixes/new`,
  `POST /f/:id/fixes`) are gone.
- A fix's page is now at its own address, showing its latest session, on a
  branch or not. A design's page still goes to `…/sessions/<id>`.
- R-h7w: with no branch, the agent runs in a new mode, `ask`, with only
  Read, Glob and Grep. Its prompt is `askPrompt`, which says it only reads
  and ends with what it would change. It may read the conversation's own
  folder, where the images are; it's told their full paths. There's no
  branch, so nothing is committed.
- `POST …/branch` names the fix's slug, and so its branch, after the name
  given in the dialog (the hint says "The branch is named after it"). The
  slug may differ from the conversation's, so the paths in its transcripts
  are moved with it. It adds the "Fixing this on…" note and commits. Then it
  redirects to the worktree's fix page. The hidden `branch.*` inputs stay in
  the dialog as designed, and the app ignores them.
- **The agent carries on** (the person, 2026-10-19). Claude Code keeps a
  conversation under the folder it ran in, and resumes it only from there.
  The fix's turns run in the branch's worktree, so when the branch is made,
  Prelude copies each session's conversation file into the worktree's folder
  (`runner.carry`, `server/agent.js`). The next turn resumes it, so the agent
  keeps what it read and found. Its first message on the branch says it can
  change the project now, and the fix's instructions replace "only read"
  (Prelude already turns off Claude Code's system prompt snapshot).
- That layout isn't a documented interface, so there's a fallback. If the
  file can't be copied, or the resume fails anyway ("No conversation found",
  `lost`), the agent starts afresh once, in the same turn. Its first message
  is a recap of what was said: the person's words and its own answers, the
  newest kept when it's long. The person's message isn't sent twice.
- Naming a conversation better (the agent suggests the conversation's name
  after its first answer, and the fix's when Fix it on a branch opens) is
  waiting on a design session: it changes R-m5c and the dialog.
- `troubles` (the starting points) are the project's stopped builds (as
  Needs you has them) and its branches whose last check failed.
- A refused rename or branch echoes what was typed. The approved screens
  for the refusals show the name as it was, because the preview re-renders
  from the state.
- After Start with this, dictation or Stop, the box's placeholder goes back
  to the design's wording. `_answering`, `_dictation-ready` and the Stop push
  render `_message-box` without the conversation's placeholder, as the
  design's own `_answering` does. You only see it when the box is emptied
  again.
- The old modal's views, `server/views/projects/_new-fix.eta` and
  `_new-fix-fields.eta`, are deleted.

## Open questions

- How long does a question stay in Asked lately: a number of them, or 30
  days untouched? And can the person remove one?
- In a project that isn't a Git repository, Fix it on a branch makes it one
  first. Should the modal say so? The page's model doesn't say whether the
  project is a repository.
- In the preview, the first message of Ask or fix lands on the sample
  question that's working, not a new one: the fake route can't make the
  page's model. The branch's About drawer and New session lead nowhere.
