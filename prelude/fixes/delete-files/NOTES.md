# Fix: delete files

## The problem

A build session ended with "Two files to delete by hand: server/views/projects/_new-fix.eta
and _new-fix-fields.eta aren't used any more, and I can't delete files." The person
shouldn't have to delete files by hand.

## The cause

The agent gets only file tools: Read, Glob, Grep, Write, Edit (`server/agent.js`,
`TOOLS`, ground rule 3 in docs/plan.md). None of them deletes a file, and Prelude gave the
agent no other way to do it. The agent was right that it couldn't. Prelude already worked
around this in one place (an emptied layouts.json counts as removed, `server/main.js`), but
had nothing general.

## The change

- `server/turns.js`: a Write with empty content that was allowed marks its file as
  emptied. When the turn ends, before the check and the commit, Prelude deletes each
  emptied file that is still empty and inside the project. A file written again later in
  the turn is kept, and so is one whose write was refused. The commit's `git add -A`
  records the deletion.
- `server/agent.js`: `DELETING`, the instruction, which every session's system prompt
  gets (turns.js appends it): design, build, fix, app and layouts sessions alike.
- Writes are still fenced the same way. An emptying Write is a Write, so the agent can only
  delete where it may write, and never in sessions/, snapshots/ or .git.
- I didn't give the agent a shell (Bash): its paths can't be fenced the way Write's are,
  and that breaks ground rule 3.
- docs/plan.md, ground rule 3: one sentence about deleting by emptying.

No design changes: no page looks or behaves differently.

## What to check

- Run `node --test test/chat.test.js` (new test: "a file the agent empties is deleted
  when its turn ends"). Also run the full suite, `node --test`, since every system prompt
  now ends with the deleting line.
- The two files from the build session (server/views/projects/_new-fix.eta and
  _new-fix-fields.eta) are on that build's branch, not this one. Once this is merged, ask
  that session to delete them and it can.
- In the transcript, a deletion still shows as "Writing <file>".
