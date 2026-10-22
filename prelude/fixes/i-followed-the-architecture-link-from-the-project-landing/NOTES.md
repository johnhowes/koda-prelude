# I followed the architecture link from the project landing…

## The problem

On the Architecture page, "Draft it from the code…" created the architecture
design and opened its first session. That session offered "Describe the
feature" and "Start from a sketch or a screenshot", which made no sense for
an architecture. Nothing said how to start the draft, so it looked like a
mistake.

## The cause

`server/views/_starters.eta` knew two kinds of session: a fix, and
everything else. A design with no screens got a feature's two starters. An
architecture has no screens until its overview.md is written, so it got
them too. The agent already knew how to draft an architecture
(`architectureSection` in `server/agent.js`); nothing on screen pointed to
it.

## The change

- `server/views/_starters.eta`: while nothing is written, an architecture
  design's session gets one starter, **Draft it from the code**. Its
  message is "Draft the architecture from the code.", so it matches the
  button that led there. The intro says the agent drafts it from the code,
  and that the Architecture page shows beside the chat once the overview
  is written. Once the overview exists, the architecture gets the usual
  starters (carry on, and so on).
- `test/system-page.test.js`: the architecture's first session offers the
  draft starter and not a feature's.
- NOTES.md of Architecture and Design Workspace say so.

## What to check

- Run `node --test test/system-page.test.js` (or `npm test`).
- In a project with no architecture: Architecture → "Draft it from the
  code…" → Create design. The session should offer only "Draft it from the
  code". Click "Start with this", then Send. The Architecture page should
  appear beside the chat once the agent writes overview.md.
- Feature designs should still show "Describe the feature" and "Start from
  a sketch or a screenshot".
