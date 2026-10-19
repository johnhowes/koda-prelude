# Ask or fix from any project

For anyone working in a project, including one with no designs yet: they can ask the agent about the project or say what's wrong straight from the project's page, and find what they asked before. A question doesn't need a design, a title or a branch first, so it's there from the very first visit. Nothing they ask gets lost: it stays on the page until it's fixed on a branch, and then it shows up with the rest of the work in progress.

## What changes

- "Fix something…" becomes **Ask or fix…**. It sits beside New design, still the plain button with New design as the main one. Hovering over it says the agent changes nothing until the fix is on a branch.
- Ask or fix… opens a conversation about the project on a page of its own, not in a pop-up. It no longer asks for a title first.
- Ask or fix… shows on every project. Before, a project with no designs and nothing in progress had no button at all.
- On a project with no designs yet, the "Design the first feature" panel gets one more line: "Not sure where to begin? Ask the agent about this project: it reads it first, and changes nothing."
- A new **Asked lately** card comes after In progress. It lists the conversations about the project that aren't on a branch yet, newest first. Each shows its name, a Working or Asking you mark while it's open, the agent's last line, and when it was. Clicking one takes the person back into the conversation.
- Under the list: "Kept on this computer, not in the project. Nothing in them changes the project until it's fixed on a branch."
- Asked lately shows on a project with no designs yet too, below the first-feature panel, so what was asked before the first design is still easy to find.
- Once a conversation is fixed on a branch, it moves from Asked lately to In progress and appears there as a Fix, with its branch.

## Acceptance criteria

- On a project with designs, Ask or fix… shows beside New design, and New design is still the main button.
- On a project with no designs, Ask or fix… shows in the page's header, and New design doesn't.
- On a project with no designs, the first-feature panel links to asking the agent about the project.
- Ask or fix… opens the conversation's page, not a pop-up, and doesn't ask for a title.
- Asked lately lists the project's conversations with no branch, newest first, each with its name, its Working or Asking you mark, the agent's last line and when it was. Clicking one opens it.
- When there's nothing to list, Asked lately doesn't show.
- On a project with no designs, Asked lately shows below the first-feature panel when there's something in it.
- **R-x8d.** Fixing a conversation on a branch keeps it: its sessions carry on as the fix's, moved into the fix's folder on the branch, and it leaves Asked lately for In progress.
- **R-k9p.** Ask or fix is offered on every project, including one with no designs yet.

## Looks right in

- **Typical**: `prelude/fix-something/snapshots/typical/f_spark-lending.html`
- **New project**: `prelude/fix-something/snapshots/new-project/f_rate-sheet-importer.html`

## For developers

- Page: `/f/:project`, view `projects/page`, data `projects/:project`. It's redesigned from `server/views/projects/page.eta`. The work region is `/f/:project/work`, view `projects/_work`, same data, redesigned from `server/views/projects/_work.eta`. `_branch.eta` hasn't changed.
- `page.eta`: the Ask or fix… link moves out of the `started` check and points to `/f/:project/d/fixes/new`, with no `ko-target="modal?"` (it's a page now, not the old modal at `/fixes/new`). It has a `title` tooltip. The empty state gains the "Not sure where to begin?" line linking to the same address. When `!started` and `p.asked` isn't empty, the page includes the work region (`ko-as="work"`, reloaded on `event:needs-changed event:projects-changed`, with no five-minute poll).
- `_work.eta`: there's a new "Asked lately" card after In progress, built from `p.asked`. Each item has `id`, `title`, `url`, `state` (`working` shows a Working pill with a pulse, `asking` shows Asking you, `answered` shows no pill), `says` (can be null) and `when`. The server lists them newest first, and the card shows only when the list isn't empty.
- Model: the project gains `asked`, the conversations kept on this computer that have no branch yet (`kind: fix`, `branch: null`).
- R-x8d on this page: when `POST /f/:project/d/fixes/:fix/branch` makes the branch, the conversation drops out of `asked` and shows up in `inProgress` as a `kind: fix` design (id `fixes/<slug>`, branch `prelude/fix-<slug>`). Its sessions move into `prelude/fixes/<slug>/` on the branch. The page reloads on `projects-changed`.
- These forms keep their behaviour; they now answer with the redesigned views. `POST /f/:project/designs` (requires `title`) and `POST /f/:project/branches/:branch/publish` answer with `projects/page`. `POST …/branches/:branch/update`, `…/abandon`, `…/merge` and `…/start` answer with `projects/_work`. `POST /f/:project/app/build`, `POST /f/:project/references` (requires `path`) and `POST …/references/:reference/remove` answer with the app's own views, which haven't changed.
- Test data:
  - `prelude/fix-something/states/01-typical.json` (spark-lending): three in Asked lately, one Working and two answered. In progress includes a fix already on a branch, "Uploads over 10 MB fail on the document checklist".
  - `prelude/fix-something/states/02-new-project.json` (rate-sheet-importer): no designs, nothing in progress, and one answered question in Asked lately.
