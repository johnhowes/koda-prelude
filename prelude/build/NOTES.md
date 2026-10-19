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
`_story-edit`, the `_rewrite` modal). States: typical, split and writing,
not approved, building, no app, all built. Event: `story-written`.

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

## In the preview only

- An edited story's rendered text doesn't change (the fake route updates
  the Markdown only); the app renders it again.
- Write every story marks the design, not each page, so only the Build
  page shows them as being written.
- Start a build session comes back to Build; the app goes to the session.

## Open questions

- Who's shown as a story's author after an edit (git's user)?
