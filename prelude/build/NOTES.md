# Build - notes

A redesign of a design's Build page (`/f/:folder/d/:design/build`): today
`server/views/_build.eta`, fed by `buildView()` in `server/main.js`, with
stories made by templates in `server/backlog.js` (`storyMarkdown`,
`incrementStory`, `layoutsStory`) from `increment.js`'s diff. The route
carries `"from": "@app/server/views/_build"`. The fake design being built
is "Loan offers" in borrower-portal (Offers, Compare offers, Accept an
offer, plus "Across the design").

Pages: Build (`build/page`, its list `build/_pages`); a page's story
(`/build/stories/:group`: `build/story`, `_stories`, `_story`,
`_story-edit`, the `_rewrite` modal); a build session
(`/sessions/:session`: `build/session`, its check `_check`, one screen
`_shot`, `_tally`, `_open-app`; `_chat`, `_transcript`, `_entry`,
`_composer` are a stand-in for the design page's chat). States: typical,
split and writing, not approved, building, no app, all built; each has a
build session (typical: mid-build, one differs, two not built; building:
the agent working, one doesn't render, the app stopped; no app: the app
stopped; all built: done). Events: `story-written`, `check-done`.

## What was wrong with it

- The story was raw Markdown in a read-only textarea behind "Copy as story".
- Stories were written for the server: route patterns, `POST … updates the
  record at …`, file paths; each card listed routes and "the design's view".
- Blockers (no app, not approved, behind main, building) were stacked cards.
- Old layout and ds/v1.
- Not only what differs from the app: `increment.js` compares with the same
  design on main, so a redesign of an app page (`"from": "@app/…"`) in a new
  design was "new" and got the whole page's story; a change on top of an
  unbuilt main design left the unbuilt part out; whole stories listed ported
  routes, built rules and every design-wide rule in every story.

## Decisions

- **Stories are written on demand, by the agent (an LLM)** (the person,
  2026-10-19): small projects may never want them; a PM on a team wants
  them good. Write the story per page, or Write every story. The agent reads
  the change, the app's page as it is now, the rules and approved screens.
- **A story is only what differs from the working app** (the person,
  2026-10-19; R-7qd, R-c9r). For the build: a page that came from the app is
  compared with the app's current file; unbuilt main-design work is
  included; only a page the app hasn't got is described whole.
- **The Build page shows what changes without a story**: per page, Prelude's
  own plain lines (new pages and overlays by title, which screens look
  different in which states, forms counted, new rules and events by their
  words). No route patterns. Design-wide rules and events are a page of
  their own, "Across the design", so they aren't repeated in every story.
- **A story is written for people**: a title, why, What changes (in terms of
  what's on screen), Acceptance criteria (what a person sees and does, with
  the rules), Looks right in (the states), then "For developers" (routes,
  views, data, test data), folded on screen and copied in full.
- **Stories are kept in the design** (proposed, 2026-10-19; R-u6t), so they're
  on the branch and reviewed with it; out of date (with what changed since)
  once the design changes after them (R-b5k).
- **Edit by hand and rewrite both** (the person, 2026-10-19). Edit swaps the
  story for a Markdown editor in place; a saved edit is marked Edited.
  Rewrite… is a modal with an optional instruction; over edits it warns
  first and says "Replace it with a rewrite" (R-z2m).
- **One story per page; split only with a good reason** (the person,
  2026-10-19; R-h8x). A split shows its reason ("Split in two: …"), each
  story with its own Copy, and Copy all.
- **A story gets its own page, not a drawer**: the drawer is the narrow
  width (`--measure-narrow`), too tight to read or edit a story.
- **One notice for what's in the way**, in order: no app, app not on the
  branch, not approved, building. Start a build session hides while any
  holds; stories can be written regardless.
- Building doesn't need a story, and a story doesn't start a build.
- **A page holds a list of stories, each its own** (the person,
  2026-10-19): one file per story, under the page
  (`stories/<page>/<n>-<slug>.md`), each copied, edited and marked edited
  on its own. A page with several lists their titles on its Build card.
- **A build session reads the page's stories** (the person, 2026-10-19;
  R-n4j): edits included (a PM's added criteria, such as a legal sign-off,
  reach the build), and it checks the build against their acceptance
  criteria. The design wins where they differ, so an out-of-date story
  can't steer a build wrong; its notice says so.

- **A build session belongs to Build, not the Design Workspace** (the
  person, 2026-10-20): it's the step after Build starts it, and what's
  beside the chat is the build, not the design.
- **Beside the chat is the check, not the design surface** (the person,
  2026-10-20): each screen of the page being built, in each state, as
  Matches, Differs, Doesn't render or Not built yet, then the rest of the
  design, counted unless something there doesn't match (a build can change
  shared parts; R-9xe). A screen opens in the panel with Built | Approved
  (| Differences), so the design is one click away without the panel
  looking like a design session.
- **Open the design opens the design's pop-out window** (the person,
  2026-10-20): the design viewer alone (pages, states, sizes), as Pop out
  opens it from the design page, in the same named window. Not a design
  session: for that, go back to the design and start one. The design's states, since the real app can't reach them.
- **No App tab; Open the app instead** (the person, 2026-10-20): the real
  app, with its own data, opens in a window of its own (Start the app first
  when this branch isn't running it). In the check's toolbar always, and in
  the "is built" notice once every screen matches.
- **A screen that differs**: Ask the agent to fix it (sends a message), or
  Approve it as built, which saves that screen only (R-f6w).
- **The chat stays the design page's.** The header now says it's a build
  session, so the chat's "This session builds …" notice goes.

## For the Design Workspace

To paste into a Design Workspace session (this design can't write there):
a build session's page is now designed in Build (`prelude/build`,
`/f/:folder/d/:design/sessions/:session` when the session is a build).
So the design page drops the Design | App switch and App mode (the real app
opens in its own window from the build session instead), and the chat's
"This session builds …" notice, since the build session's header says it.
Design sessions are otherwise unchanged.

## In the preview only

- The check's pictures are placeholders: in the app, Built is the page as it
  renders from the branch in that state, Approved the approved PNG,
  Differences the built one with what changed marked.
- Start the app posts a hidden `running` so the preview shows it started.
- The stand-in chat's Stop posts an empty `status`.

- An edited story's rendered text doesn't change (the fake route updates
  the Markdown only); the app renders it again.
- Write every story marks the design, not each page, so only the Build
  page shows them as being written.
- Start a build session comes back to Build; the app goes to the session.

- **An edited story names who edited it last, and when** (the person,
  2026-10-19): git's user name on the computer that saved it ("Edited by
  John Howes, today at 09:14"), beside the story's title.

## Built into the app (the Build page, 2026-10-19)

- The page is `server/views/_build.eta` (ported back over the old one), its
  pages `server/views/build/_pages.eta`, its model and the story writer
  `server/build.js`, the agent's brief `storyPrompt` (agent.js). It renders
  in the app layout now, with the app's live channel (`/live`); the server
  sends `story-written` there once a story is written.
- A page's stories are kept in the design: `stories/<page>/<n>-<slug>.md`
  (the agent's, or a person's edit), `split.md` (why it's split) and
  `story.json` (Prelude's: when it was written, a fingerprint of what it was
  written from, and the page's change lines then). A different fingerprint
  is Out of date; what changed since is the lines that came and went.
  Each written story is committed to the branch (R-u6t). A person's edit
  should set `story.json`'s `edited["<n>"] = { by, at }`.
- A redesign of an app page in a design with nothing on main to compare
  with (`from`, no baseline) "looks different in" every state: Prelude
  can't render the app's page to compare. The agent writing its story reads
  both files and describes only the differences.

## Built into the app (a page's story, 2026-10-19)

- The page is `server/views/build/story.eta`, with `_stories`, `_story`,
  `_story-edit` and the `_rewrite` modal beside it, answered in `main.js`
  (`storyPage`; its model is the Build page's group, `groupView`). The page
  reloads its stories on `story-written`, as the Build page does.
- A person's edit is saved over the story's file, and `story.json` gets
  `edited["<n>"] = { by: git's user.name, at }` (`saveStory`, build.js); it's
  committed to the branch like the agent's stories (R-u6t). The edit form
  posts only `markdown`: the design's hidden `edited`, `url` and `title` are
  left out, as its own comment said, since the server knows the story by its
  address.
- A rewrite (R-z2m): the modal is what asks. The old stories stay on show
  while the agent writes; once it has written at least one, each old file it
  didn't write again is removed (split.md too), and `story.json` starts
  afresh with no edits. If it writes nothing, the old stories and their edits
  stay. The instruction goes to the agent with the request, and the page shows
  it while the rewrite runs ("You asked: …"); it isn't kept after.
- A build session (R-n4j) is told the page's story files, which were edited
  by a person, to check the build against their acceptance criteria, that
  the design wins where they differ, and to say where in NOTES.md
  (`buildPrompt`'s `stories`).
- One per page, split only with a reason (R-h8x), is the agent's brief
  (`storyPrompt`); the reason is `split.md`, shown as "Split in two: …".

### Where the design is silent

- **Who edited it, with no git user**: the pill says Edited without the "by …"
  line.

### Where the design is silent

- **A refusal has no place on the page** (a build that can't start, an
  approval over pages that don't render). The app says it in the layout's
  notice region (`build/_refused.eta`).
- **A page waiting for the shell's layouts** still shows Start a build
  session (the old page said it waits); starting it is refused, saying why.
- **The shell's layouts** don't need approved screens to build, but Start a
  build session only shows once the design is approved.

## Built into the app (a build session, 2026-10-20)

- A page's build session (not the app build or the shell's layouts, which
  have no screens of their own) is `server/views/build/session.eta`, with
  `_check`, `_shot`, `_tally` and `_open-app` beside it, answered in
  `main.js` (`buildSessionPage`; its model `buildSessionView`, typed in
  `server/check.js`). It renders in the app layout like the Build page. A
  design session's page is unchanged.
- **The chat is the design page's own** (`server/views/_chat.eta`, given
  `chat`, the design page's model), with its transcript, queue, images and
  Stop. Its "This session builds …" notice doesn't show: the chat is given
  the session without its build. Sending a message, and Stop, are the design
  page's routes as they were. The design's states have no chat model, so
  for them `build/_chat` is still the design's stand-in (with `_transcript`,
  `_entry` and `_composer`, which the messages and fix routes name).
- **The check** (R-9xe) is kept with the session, `sessions/<id>/check.json`:
  after each build turn, stopped or not, the whole design is rendered as
  before, and each titled page and overlay in each state is Matches,
  Differs, Doesn't render, or (the page being built, still the design's own
  view) Not built yet. The page then hears `check-done` down the session's
  channel, with the tally pushed into `check-tally`. The rest of the design
  can't be Not built yet: it's compared with its approved screen whether it's
  built or not.
- **Approve it as built** (R-f6w) renders that one screen again, as it is
  now, and writes its snapshot alone (`writeSnapshot`); it's committed to the
  branch unless a turn is under way, whose commit takes it.
- **Ask the agent to fix it** sends the form's message as the person's, or
  queues it while the agent works. Its answer is empty: the message reaches
  the transcript down the session's channel, as every message does.
- **Start the app** starts the branch's design host, as the project page's
  Start does, and comes back to the session. Its form posts only `back`.

### Where the design is silent

- **Before the first turn ends** there's no check yet: the page shows the
  screens as the build found them (the page being built's unported screens
  Not built yet, the rest as approved), "checked" when the session started.
- **While Prelude checks** after a turn, the agent isn't working, so the
  check doesn't say it is.
- **No design host** (an app Prelude can't run): Open the app and Start the
  app don't show.
- **The screens' pictures** are still the design's placeholders (see Open
  questions): snapshots are HTML, so there's no approved picture to show yet.

## Open questions

- **How Differences marks what changed**: a pixel overlay on the built
  screen, or the two side by side? Placeholders for now.
