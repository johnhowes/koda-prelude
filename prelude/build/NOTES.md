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

## Open questions

- Where a story's plain words come from (see the reply on 2026-10-19).
