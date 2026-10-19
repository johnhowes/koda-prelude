# Ask first, then fix it on a branch

For anyone who has asked the agent about the project or said what's wrong. They can keep talking it through, knowing nothing in the project changes, and only make a branch once they know there's something to fix and what to call it. The conversation they've had carries on as the fix's, so nothing they found out gets lost. They can also give it a better name than its first words at any time.

## What changes

- Under the conversation's title, a line reads: "**Reading only** · The agent answers from the project and changes nothing. If something needs fixing, fix it on a branch." It shows until the conversation is on a branch.
- Until then, the header has **Fix it on a branch…** where a design's branch and About the design would be. Hovering over it says: "Make a branch for this, and let the agent change the project there."
- **Fix it on a branch…** opens a dialog over the conversation. It says what will happen before anything does: Prelude makes a branch for this fix from main, in a worktree of its own, and the agent fixes it there, in the app, the designs or both, keeping the designs in step. Each turn is committed to the branch, and nothing reaches main until the person merges it or pushes it for a pull request. It also says the conversation carries on as the fix's and moves into the project with it.
- The dialog asks for **The fix's name**, filled in with the conversation's name to start with, and says: "A few words. The branch is named after it."
- **Make the branch and fix it** makes the branch and takes the person back to the conversation, now on its branch: the Reading only line and Fix it on a branch… are gone, the header shows the branch as on any fix, and the transcript says the fix is now on that branch and the agent can change the project there. **Not now** closes the dialog and changes nothing.
- The conversation is named from the first words of its first message. Beside the title there's a rename button ("Rename it"), on a branch or not.
- The rename button opens **Rename it**, a dialog with the name filled in, **Rename** and **Not now**. On a fix that's on a branch, it says under the name that the branch keeps its name, and shows the branch.
- Leaving the name empty, in either dialog, is refused with "This is required." and the dialog stays open with what was typed.
- The message box says: "Ask about the project, or say what's wrong and where; paste a screenshot of it." It no longer has the "what you're looking at" chip, since there's no page on show beside the chat.
- The chat sits in the middle of the page at a readable width instead of stretching across the window.

## Acceptance criteria

- A conversation that isn't on a branch shows the Reading only line under its title, and Fix it on a branch… in the header instead of a branch or About the design.
- Fix it on a branch… opens a dialog over the conversation that says what making the branch does, with the fix's name filled in from the conversation's.
- Make the branch and fix it makes a branch named after the fix's name and returns to the conversation, which now shows its branch, no Reading only line, and no Fix it on a branch….
- After the branch is made, the same conversation carries on: its earlier messages are still there, followed by a line saying the fix is on its branch and the agent can now change the project.
- Not now closes either dialog and changes nothing.
- The rename button shows beside the title of a conversation, whether it's on a branch or not.
- Rename changes the title in the header, and the conversation keeps that name from then on.
- On a fix that's on a branch, Rename it says the branch keeps its name, and shows it.
- An empty name in either dialog shows "This is required." and the dialog stays open.
- The message box shows the conversation's placeholder and no "what you're looking at" chip.
- On a wide window the chat is centred at a readable width. On a narrow one it fills the column.
- **R-h7w.** Until a conversation about the project is fixed on a branch, the agent only reads: nothing in the project changes, and nothing is committed.
- **R-m5c.** A conversation is named from the first words of its first message, until the person renames it.
- **R-j3v.** Renaming a fix on a branch keeps the branch's name.

## Looks right in

- **Typical**: `prelude/fix-something/snapshots/typical/f_spark-lending_d_fixes_payment-dates-a-day-early.html`, with Fix it on a branch in `…_payment-dates-a-day-early_branch.html` and Rename it in `…_payment-dates-a-day-early_rename.html`
- **New project**: `prelude/fix-something/snapshots/new-project/f_rate-sheet-importer_d_fixes_what-is-in-this-repository.html`, with Fix it on a branch in `…_what-is-in-this-repository_branch.html` and Rename it in `…_what-is-in-this-repository_rename.html`

## For developers

- Page: `/f/:project/d/fixes/:fix`, view `_session`, data `projects/:project/fixes/:fix/page`. `_session.eta` is the same as the app's (`server/views/_session.eta`). The changes are in the partials it includes: `_header`, `_chat`, `_composer`, `_message-box` and `_starters`. The model is a fix (`kind: 'fix'`, id `fixes/<slug>`) with `branch: null` until it's fixed on a branch. It's kept on this computer until then. The page lives at the fix's own address, not at `…/sessions/:session`.
- `_header.eta`: `reading = kind === 'fix' && !branch && !merged`, and `fresh = reading && !sessions.length`. When `reading` and not `fresh`, the branch summary button is replaced by Fix it on a branch… (`ko-target="modal?"`), and the Reading only line shows with the wording for a conversation already started. The `<h1>` sits in a cluster with a Rename icon button (`icon-rename`, `ko-target="modal?"`, with an `sr-only` "Rename <title>"). It shows for any fix that isn't `fresh`, on a branch or not.
- `_chat.eta`: New session is hidden only when `fresh`, so it's still on this page. `_starters.eta`: a new session of a fix that has earlier sessions gets the intro "A new session. The agent starts from what the earlier sessions found.", plus a starter for each of `it.troubles`.
- `_composer.eta`: a fix passes a `placeholder` to `_message-box` and leaves out the looking-at chip (the app's fix page shows one today). `_message-box.eta` takes the optional `placeholder` and falls back to the design wording.
- `styles.css`: the chat is centred at `var(--measure)` when it's the workspace's only child and the container is `>= 52rem`. It replaces `workspace.css`'s `:only-child` rule.
- Dialogs, both `in: "modal"` over the page with the same data:
  - `/f/:project/d/fixes/:fix/branch`, view `_fix-branch`, fields `_fix-branch-fields` (prefilled from `it.title`).
  - `/f/:project/d/fixes/:fix/rename`, view `_rename`, fields `_rename-fields` (`title`, plus `branch` for the hint when it has one).
  - Not now is `command="--koda-empty" commandfor="modal"`. On a refusal only the fields come back (`ko-target="fields"`), with `$errors.title`.
- Forms:
  - `POST /f/:project/d/fixes/:fix/branch` updates `…/fixes/:fix/page`, requires `title` (form `_fix-branch-fields`) and redirects to `/f/:project/d/fixes/:fix`. In the app it makes the branch `prelude/fix-<slug>` from main and its worktree, moves the sessions into `prelude/fixes/<slug>/` on the branch, commits, adds a `note` entry ("Fixing this on <branch>, made from main. The agent can change the project there now; each turn is committed to the branch."), and redirects to the worktree's fix page. The app reads only `title`. The hidden `branch.*` inputs are there only so the preview's model looks right afterwards.
  - `POST /f/:project/d/fixes/:fix/rename` updates `…/fixes/:fix/page`, requires `title` (form `_rename-fields`) and redirects to the page. It changes the title only, never the branch (R-j3v), and marks it as named by the person, so it's no longer named from the first message (R-m5c).
  - These answer as the app's design chat does, at this page's addresses. `POST …/sessions/:session/messages` adds to `…/page/entries` and `POST …/sessions/:session/queue` adds to `…/page/queued`. Both require `message` and answer with `_composer`, also refreshing `transcript` or `queued`. `POST …/queued/:queued/cancel` answers with `_queued`. `POST …/sessions/:session/stop` updates `…/page/state` and answers with `_status`. `POST …/start` and `POST …/draft` update `…/page/draft` and answer with `_answering` and `_draft-kept`. `POST …/attachments` and `POST …/attachments/:attachment/remove` answer with `_attachments`.
- Regions it reloads: `/f/:project/d/fixes/:fix/draft` (view `_attachments`, data `…/page/draft`) on `event:draft-changed`, and `/f/:project/d/fixes/:fix/dictation/button` (view `_dictation`, data `…/page`) on `event:dictation-changed`.
- R-h7w: a conversation with no branch runs its agent read-only: `permissionArgs` in mode `fix` with no branch allows no writes, and `fixPrompt` says it only reads and should end with what it would change. Nothing is committed.
- Test data:
  - `prelude/fix-something/states/01-typical.json` (spark-lending): `payment-dates-a-day-early` is answered and idle, with no branch (the approved screens). `rate-lock-build-stopped` is working, so the box queues. `large-uploads-fail` is already on `prelude/fix-large-uploads-fail`, with the "Fixing this on…" note in its transcript, so Rename it shows the branch hint there.
  - `prelude/fix-something/states/02-new-project.json` (rate-sheet-importer): `what-is-in-this-repository` is one answered question with no branch, and dictation isn't set up.
  - Refused names: `snapshots/<state>/POST_…_branch.html` and `POST_…_rename.html` in each state's folder. The draft and dictation regions are `…_draft.html` and `…_dictation_button.html`.
- Open (NOTES.md): in a project that isn't a Git repository, Fix it on a branch makes it one first, and the dialog doesn't say so yet.
