# Clean up what Prelude leaves behind

For anyone who has worked on a project for a while and finds old branches and worktree folders piling up. Prelude tidies a branch by itself only when all its work is in main. Everything else stays: a branch with commits after its pull request merged, a branch it lost track of, one made and never used, a folder left behind, and the copies on the remote. Today the person has to find these by hand in git. Once this is built, the project page lists them in one place, with why each is there. Only the ones that are safe to remove start picked, and nothing goes until the person says so.

## What changes

- When Prelude has found anything it won't tidy by itself, In progress's heading has a "Clean up…" button showing how many. With nothing in progress, a line of its own says how many branches and folders there are, with the same button.
- Clean up opens in a dialog over the page, titled "Clean up" and the project's name. It explains that Prelude removes a branch by itself once its work is in main, and that these are what it leaves to the person.
- Under "On this computer", each branch or folder shows:
  - its name, and what it is: "Pull request merged", "In main", "Nothing done on it", "Not in Prelude's list" or "Folder only"
  - warnings where work would be lost: "2 commits since", "1 commit not in main", "2 files not committed"
  - a sentence saying why it's there, e.g. "Made for Closing day checklist 2 weeks ago, and never worked on."
  - for a merged pull request with commits since, which files changed since
  - its folder, or that it's a branch with no worktree
- Only those whose work is all in main, or with nothing done, start picked. The person can pick or unpick any of them.
- A branch the agent is working in shows "Working" and can't be picked until its turn ends.
- Branches on the remote are listed apart, under "On origin". A warning says others can see them, and to pick one only if nobody else is using it. None starts picked.
- "Remove what's picked" removes only what's picked. "Not now" closes the dialog and changes nothing. A note says a design host running from a worktree is stopped first, and that what's removed can't be brought back from Prelude.
- Afterwards the dialog closes and the page shows what's left. A notice says what went, e.g. "Removed 2 branches and folders: …", or "Nothing was picked, so nothing was removed."
- With nothing to clean up, the dialog says so, with "Back to the project".
- A branch whose pull request was merged, with commits since, links to Clean up from its line: "clean the branch up".

## Acceptance criteria

- **R-c3j.** Clean up lists what Prelude won't tidy by itself, each with why it's there, and removes only what the person picks; it starts with only those whose work is all in main, or with nothing done, picked.
- **R-9xk.** Branches on the remote are listed apart in Clean up, with a warning that others can see them, and are never picked to start with.
- With branches or folders to clean up, In progress's heading shows "Clean up…" with their count. With none, it doesn't show.
- In Typical, Clean up lists 4 on this computer. Prequalification's branch and the Document checklist folder are picked. Underwriting queue (2 commits since) and Servicing notes (1 commit not in main, 2 files not committed) aren't.
- Each one on this computer says why it's there, and warns when commits or uncommitted files would be lost with it.
- In Typical, the 3 branches on origin are listed under their warning, none picked.
- A branch the agent is working in can't be picked.
- Removing deletes only the picked branches, worktrees and folders, here and on origin. It leaves everything unpicked as it was, and the notice names what went.
- Removing with nothing picked removes nothing and says so.
- "Not now" closes the dialog and removes nothing.
- A project with nothing to clean up has no Clean up button, and its dialog says "Nothing to clean up".

## Looks right in

- **Typical**: In progress shows "Clean up…" with 7. The dialog lists 4 on this computer (2 picked) and 3 on origin (none picked). See the approved screens `typical/f_spark-lending.html`, `typical/f_spark-lending_work.html` and `typical/f_spark-lending_cleanup.html`.
- **Large project**: "Clean up…" with 9. The dialog lists 4 on this computer, all safe and picked: a branch with nothing done, a fix's branch already in main and two leftover folders. It also lists 5 on origin, none picked. See `large-project/f_spark-platform.html`, `large-project/f_spark-platform_work.html` and `large-project/f_spark-platform_cleanup.html`.
- **App being built**, **Update clashed** and **Long names**: nothing to clean up, so there's no button, and the dialog says so. See `app-being-built/f_borrower-portal_cleanup.html`, `update-clashed/f_borrower-portal_cleanup.html` and `long-names/f_mortgage-origination_cleanup.html`.
- **New project**: nothing to clean up. See `new-project/f_rate-sheet-importer_cleanup.html`.

## For developers

- New address `/f/:project/cleanup` (Clean up): view `projects/_cleanup`, data `projects/:project`, in the modal over `/f/:project`.
- Changed: `/f/:project` (view `projects/page`) and `/f/:project/work` (view `projects/_work`). `_work` shows the button with a count, or the line with nothing in progress. `projects/_branch` links its merged-pull-request line to `…/cleanup`.
- New form `POST /f/:project/cleanup`:
  - Updates `projects/:project/cleanup`.
  - Each item posts `removed.<id>` as `true` or `false`, with a hidden `false` before its checkbox.
  - It answers into `modal?` (closing it), reloads `projects/page` into `main` and says `projects/_cleaned` into `notice?`.
  - In the design a removed branch stays under In progress. The app should take it out.
- The model gains `cleanup: { into, items, removed }`, which the app prepares.
  - Each item: `{ id, where: "local" | "origin", kind, name, path, design, when, ahead, uncommitted, since: { commits, files }, working, safe }`.
  - Kinds:
    - `pr-merged`: its pull request merged, with commits since
    - `merged`: a branch Prelude no longer lists, its work in main
    - `untouched`: made and never worked on
    - `unlisted`: a worktree Prelude no longer lists, with work not in main
    - `leftover`: a folder whose branch was tidied while it was in use
    - on origin, `pr-merged` or `merged`
  - `safe` is true when all the work is in main, or nothing was done. The app picks those to start with; on origin, it never picks any.
  - `working` is true when the agent is working in it. The view doesn't let it be picked.
  - Find these by reading git and Prelude's own list of worktrees, never by asking the agent. "In main" uses the same trial-merge test as tidying (see the other story).
  - The NOTES propose listing a branch with nothing done only once it's a week old.
- Removing:
  - Stop any design host running from a worktree first.
  - Remove the worktree, the branch, or the leftover folder.
  - On origin, delete the remote branch.
  - The design's count on the button includes origin's items.
- Test data, in `prelude/project-landing-page/states/`:
  - `01-typical.json`: 4 local items (`c-uq` pr-merged, `c-pq` merged, `c-sn` unlisted with uncommitted files, `c-dc` leftover) and 3 on origin.
  - `06-large-project.json`: 4 local items (untouched, merged, two leftovers), all safe, and 5 on origin.
  - `02-new-project.json`, `03-app-being-built.json`, `04-update-clashed.json` and `05-long-names.json`: no items.
  - No state has an item the agent is working in.
- Approved screens: `prelude/project-landing-page/snapshots/<state>/f_<project>_cleanup.html`, beside each state's page and `…_work.html`.
