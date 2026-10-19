# Fix Something - notes

A UX review and redesign of step 11's Fix (docs/plan.md): starting a fix
from the project page, its session, and how it's listed. Also: asking the
agent a question about the project, which changes nothing.

Today's app: "Fix something…" in the project page's header
(`server/views/projects/page.eta`) opens a modal (`_new-fix.eta`,
`_new-fix-fields.eta`) asking for a title and a first message; posting makes
the branch and worktree, the fix's folder, and its first session
(`POST /f/:id/fixes`, `server/main.js`). The fix's page is the design page
without the design surface; it's listed under In progress (`_work.eta`,
`_branch.eta`).

## Review (2026-10-19)

1. **The title comes before the problem.** "What's wrong" is required and
   names the branch ("the fix's name, and its branch's"), so the person must
   sum up a problem before describing it, in branch terms.
2. **The modal is a lesser composer.** No images, paste, drop, capture or
   dictation, though a screenshot of the error is often the first thing to
   say ("A screenshot can follow in the chat").
3. **A branch is made before anything is known.** Many problems turn out
   to be a question, a misunderstanding, or not Prelude's; each still leaves
   a branch under In progress ("Nothing done on it yet") to tidy away.
4. **No way to just ask.** "How does approving work?", "Which designs use
   the drawer?", "Why does this page look different in the app?" have
   nowhere to go but a design session, which they don't belong to, or a fix,
   which makes a branch.
5. **Hidden on a new project.** The button shows only once there's a
   design, but a new project is when questions are likeliest.
6. **Small:** "Start the fix" carries the add icon; the header's button the
   agent icon. Not reachable from a design's page (the plan's "not now").

## Proposal (waiting for the person)

- **One conversation about the project, that becomes a fix when it needs
  to.** "Ask or fix…" opens a new conversation with the full composer. The
  agent only reads; it answers, or finds the cause and says what it would
  change. "Fix it on a branch" (the person's choice) makes the branch, and
  the conversation carries on as the fix's session.
- **No title to write**: named from the first message, renamable.
- **Questions listed apart from branches**: "Asked lately" on the project
  page, not In progress.

## Open questions

- One entry that can become a fix, or two (Ask a question… / Fix
  something…)?
- Where a question is kept when it has no branch: on this computer only
  (`~/.prelude/`), or committed somewhere in the repository?
- Is a question a kind of Fix (the same noun, before its branch), or a
  noun of its own? The plan asks each noun to earn its place.
