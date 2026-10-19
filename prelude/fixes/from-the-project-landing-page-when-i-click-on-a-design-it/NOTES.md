# Fix: From the project landing page, when I click on a design, it…

## The problem

Clicking a design on the project page always opened its previous session,
even one that had long finished, or a build that was already done.

## The cause

The project page links each design to `/f/<project>/d/<design>`
(`server/views/projects/_designs.eta`). For that address, `handleDesign`
(`server/main.js`) always redirected to the design's newest session. It didn't
check whether anything was still going on there. No design said what opening
a design should show. Design Workspace's starting points for a new session
(R-e9t, including "Carry on from…") only appeared if you started a new
session yourself.

## The change

- **Design Workspace** has a new rule, **R-o4s**: opening a design shows its
  latest session only while the agent is working there, or a turn has ended
  there that you haven't seen. Otherwise it shows a new session with its
  starting points. Its NOTES.md records this.
- **The app** (`server/main.js`, the `…/d/<design>` GET): `stillOpen()` decides
  whether to redirect. It returns true while a turn is running or being
  checked in that session, or when a turn ended there in the last week and
  you haven't opened the session since. That's the same "seen" that Home's
  Needs you uses, and seen.json forgets after a week. A stopped turn doesn't
  count. Otherwise the page is a new session, the same as
  `…/sessions/new`. A fix's page is unchanged: it still shows its latest
  session at its own address (prelude/fix-something).
- **Test**: `test/chat.test.js` ("the first message starts a session…") now
  also checks that once the session has been opened, the design's address
  is a new session.

## What to check

- Run `node --test test/chat.test.js`, then the whole suite (`node --test`).
- On a project page, click a design whose last session you've already read.
  It should open a new session, with "Carry on from…" among the starting
  points, and the sessions menu should still list the old sessions.
- Click a design where the agent is working, or whose turn finished while
  you were elsewhere. It should open that session.
- Home's In progress links go to the same address, so they now behave the
  same way.
