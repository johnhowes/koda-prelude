# Build - notes

A redesign of a design's Build page (`/f/:folder/d/:design/build`): today
`server/views/_build.eta`, fed by `buildView()` in `server/main.js`, with
the stories written by `server/backlog.js` (`storyMarkdown`,
`incrementStory`, `layoutsStory`). It renders in the old `layout.eta`, not
the shell's layouts the Design page now uses.

## What's wrong with it today

- The story is raw Markdown in a read-only textarea, hidden behind "Copy as
  story": you can't read it as a story.
- Stories are written for the server, not for people: "Fragment at
  `/f/:folder/d/:design/draft`", acceptance criteria as `POST … updates the
  record at …, answers with …`, file paths and fixtures throughout.
- Each page's card lists route patterns and "the design's view" /
  "the app's own view", which mean nothing to a designer or product owner.
- What's blocking a build (no app, not approved, behind main, another group
  building) is a stack of plain cards with long explanations.
- The header and chrome differ from the Design page's (old layout, old
  crumbs, `/ds/v1`).

- Stories aren't only what differs from the working app. `increment.js`
  compares the design with the same design on main, not with the app: a
  redesign of an app page (`"from": "@app/…"`) in a new design is "new" and
  gets the whole page's story; a change on top of an unbuilt main design
  leaves the unbuilt part out; whole stories list ported routes, built
  rules and every design-wide rule.

## Decisions

- **Stories are written on demand, by an LLM** (the person, 2026-10-19):
  small projects may never want them; a PM on a team wants them good. The
  Build page shows what changes per page without a story; Write story asks
  the model, in terms of what people see and do, with developer details
  folded at the end.
- **A story is only what differs from the working app** (the person,
  2026-10-19). Proposed fix: a page that came from the app is compared with
  the app's current file; unbuilt main-design work is included; only a page
  the app hasn't got is described whole.

## Open questions

- Proposed, not yet agreed: stories saved in the design (`stories/*.md`),
  marked out of date when the design changes, Rewrite with an instruction.
- Can a PM edit a story by hand in Prelude, or only rewrite it?
- One story per page, or may the model split a big change into several?
