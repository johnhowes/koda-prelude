# Rules: Fix Something

- **R-h7w.** Until a conversation about the project is fixed on a branch, the agent only reads: nothing in the project changes, and nothing is committed.
  *shown-on: /f/:project/d/fixes/:fix*
  *proposed*
- **R-2qz.** A conversation with no branch is kept on this computer only, never in the project's repository.
  *proposed*
- **R-m5c.** A conversation is named from the first words of its first message, until the person renames it.
  *shown-on: /f/:project/d/fixes/:fix*
  *proposed*
- **R-x8d.** Fixing a conversation on a branch keeps it: its sessions carry on as the fix's, moved into the fix's folder on the branch, and it leaves Asked lately for In progress.
  *shown-on: /f/:project*
  *proposed*
- **R-j3v.** Renaming a fix on a branch keeps the branch's name.
  *shown-on: /f/:project/d/fixes/:fix/rename*
  *proposed*
- **R-k9p.** Ask or fix is offered on every project, including one with no designs yet.
  *shown-on: /f/:project @ new-project*
