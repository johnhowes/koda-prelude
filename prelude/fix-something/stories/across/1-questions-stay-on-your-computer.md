# Questions stay on your computer

For anyone who asks the agent about a project before deciding to fix anything. A question, a half-formed worry or a screenshot of something odd shouldn't end up in the project's history for the whole team to see, or leave stray files behind in the project. Until the conversation is fixed on a branch it's theirs alone, on their own computer, so they can ask freely and the project stays as it was.

## What changes

- A conversation that isn't on a branch is kept on this computer, alongside the person's drafts, not in the project.
- Asking a question, and every answer, leaves the project's files untouched: there's nothing new to commit, and nothing shows up as changed in the project.
- Screenshots attached to a question are kept on this computer with it, not in the project.
- Teammates who open the same project don't see someone else's questions. Each person's Asked lately shows only what they asked on that computer.
- Once the conversation is fixed on a branch, it goes into the project with the fix, on that branch, and from then on it's kept like any other fix's sessions.

## Acceptance criteria

- After asking a question and getting an answer, the project shows no new or changed files, and nothing has been committed.
- An image attached to a question, once sent, is still shown in the conversation, and isn't in the project's folder.
- A question asked on one computer doesn't show in Asked lately on another computer with the same project.
- Reopening Prelude on the same computer finds the conversation as it was left, in Asked lately and on its own page.
- After Fix it on a branch, the conversation's sessions and images are on the fix's branch, and none of it is left behind on this computer.
- **R-2qz.** A conversation with no branch is kept on this computer only, never in the project's repository.

## Looks right in

- **Typical**: `prelude/fix-something/snapshots/typical/f_spark-lending_d_fixes_payment-dates-a-day-early.html` (a question with no branch), and `prelude/fix-something/snapshots/typical/f_spark-lending.html` (it in Asked lately)
- **New project**: `prelude/fix-something/snapshots/new-project/f_rate-sheet-importer_d_fixes_what-is-in-this-repository.html`, and `prelude/fix-something/snapshots/new-project/f_rate-sheet-importer.html`

## For developers

- This rule has no screen of its own: it's where the data behind `projects/:project/fixes/:fix/page` (`kind: 'fix'`, id `fixes/<slug>`, `branch: null`) and the project's `asked` list are kept. It applies to every route under `/f/:project/d/fixes/new` and `/f/:project/d/fixes/:fix` while the fix has no branch.
- Keep it under Prelude's home (`PRELUDE_HOME`, or `~/.prelude`, `server/main.js`), next to drafts (`server/drafts.js`, `<home>/drafts/<folder>/…`). For example `<home>/asked/<folder>/<slug>/`, holding the record (title, whether the person named it, when) and its `sessions/<id>/` (session.json, transcript.jsonl, images/). Nothing goes under the project's path, in the main checkout or any worktree, so `git status` stays clean.
- `POST /f/:project/d/fixes/new/sessions` makes the record and its first session there, not in `prelude/fixes/<slug>/`. The slug must be unique against both the local records and the project's `prelude/fixes/`, and `new` is reserved.
- Sending a message today moves a draft's images into the session's folder in the project (`drafts.send`, `prelude/<design>/sessions/<id>/images/`). For a fix with no branch they go into the local session's `images/` instead. The agent reads them from there, so the read-only permissions (R-h7w) must still allow reading that folder.
- The project's `asked` is built from the local records for that project (newest first), not from the repository.
- `POST /f/:project/d/fixes/:fix/branch` moves the local sessions, images included, into `prelude/fixes/<slug>/` in the new worktree, commits them, and then removes the local record and the fix's drafts key, so it isn't in `asked` any more.
- Test data: `prelude/fix-something/states/01-typical.json` (spark-lending: `rate-lock-build-stopped`, `payment-dates-a-day-early` and `which-designs-show-the-loan-summary` have no branch; `large-uploads-fail` is on `prelude/fix-large-uploads-fail`, so it's kept in the project) and `prelude/fix-something/states/02-new-project.json` (rate-sheet-importer: `what-is-in-this-repository`, with no branch, in a project with no designs yet).
- Open (NOTES.md): how long a question stays in Asked lately, and whether the person can remove one. That decides when a local record gets cleared.
