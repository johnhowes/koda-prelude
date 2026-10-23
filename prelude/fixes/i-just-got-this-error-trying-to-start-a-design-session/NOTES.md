# I just got this error trying to start a design session!

## The problem

A message on Project Landing Page ("The link in In Progress should be dynamic…", session `20261023-1203-lx77`) failed straight away with "Prompt is too long · the request is ~1201455 tokens (limit 1000000)". The agent hadn't read anything yet. After that the session was stuck: each message there resumed the same oversized conversation.

## The cause

- `server/views/projects/_app.eta` on `prelude/project-landing-page` had git conflict markers committed in it. The template didn't compile ("Bad template syntax: Identifier 'p' has already been declared").
- Every route of the design that renders the project page failed, in every state. Eta's error includes the whole compiled template (tens of KB each time).
- `withFindings` (`server/turns.js`) put every finding, at full length, in front of the person's next message. That made one line of request about 8 MB.
- A "Prompt is too long" result was treated as an ordinary error, so the session couldn't recover.
- Prelude refuses to commit an update from main while a clashing file still has markers. It only checked the files it had recorded as clashing, though, not every file git still holds as unmerged. It isn't certain this is how the markers got in.

## The change

- `server/turns.js`: findings are grouped and kept short. The same error is said once, naming up to 6 places where it happened, and "and N more". Each error is cut to 20 lines or 1500 characters, and each kind lists at most 20 distinct problems.
- `server/renderer.js`: a view that doesn't compile reports Eta's message without the compiled template, and names the view file.
- `server/agent.js`: a "Prompt is too long" result counts as `lost`.
- `server/main.js`: every session gets a recap, not only one carried onto a fix's branch. A lost session (too long, or not resumable on this machine) starts afresh once, told what was said so far. Before, only carried sessions did.
- `server/branches.js` (`merging`): files git still holds as unmerged count as clashes too, so a merge is never committed with their markers in it.

## What to check

- Run `npm test`, in particular `test/host.test.js`, `test/chat.test.js` and `test/build.test.js`.
- Break a view on purpose (a `let` declared twice) and send a message. The finding should be short, name the view, and appear once for all the routes.
- Markers committed outside an update from main are still only caught when they break something the check renders.
