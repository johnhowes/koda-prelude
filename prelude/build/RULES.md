# Rules: Build

- **R-7qd.** What a page lists, and what its story says, is only what the design changes compared with the app as it is now: a redesigned page the app already has shows its differences, not the whole page.
  *shown-on: /f/:folder/d/:design/build*
- **R-w3n.** A story is written only when someone asks for one; a design can be built without any.
  *shown-on: /f/:folder/d/:design/build*
- **R-h8x.** The agent writes one story per page, and splits it only when the parts could ship on their own, saying why.
  *shown-on: /f/:folder/d/:design/build/stories/:group @ split-and-writing*
- **R-b5k.** A story says it's out of date once the design changes after it was written, and says what changed since.
  *shown-on: /f/:folder/d/:design/build @ typical*
- **R-z2m.** Rewriting a story that was edited by hand asks first, because the rewrite replaces those edits.
- **R-u6t.** A story is kept with the design on its branch, so it's reviewed and merged with the design; a person's edits are kept the same way.
- **R-n4j.** A page's build session is given its stories, edits and all, and checks the build against their acceptance criteria; where a story and the design differ, the design wins.
  *shown-on: /f/:folder/d/:design/build/stories/:group*
- **R-c9r.** A story never repeats what's already built: no built rules, no pages the app already has, and no rule from another page's story.
- **R-f6w.** Approving a screen as built in a build session saves only that screen; every other screen is still checked against the design.
  *shown-on: /f/:folder/d/:design/sessions/:session/check/:shot*
- **R-9xe.** A build session checks every screen again each time the agent's turn ends, including pages of the design it isn't building.
  *shown-on: /f/:folder/d/:design/sessions/:session*
