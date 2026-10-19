# Rules: Build

- **R-7qd.** What a page lists, and what its story says, is only what the design changes compared with the app as it is now: a redesigned page the app already has shows its differences, not the whole page.
  *shown-on: /f/:folder/d/:design/build*
  *proposed*
- **R-w3n.** A story is written only when someone asks for one; a design can be built without any.
  *shown-on: /f/:folder/d/:design/build*
  *proposed*
- **R-h8x.** The agent writes one story per page, and splits it only when the parts could ship on their own, saying why.
  *shown-on: /f/:folder/d/:design/build/stories/:group @ split-and-writing*
  *proposed*
- **R-b5k.** A story says it's out of date once the design changes after it was written, and says what changed since.
  *shown-on: /f/:folder/d/:design/build @ typical*
  *proposed*
- **R-z2m.** Rewriting a story that was edited by hand asks first, because the rewrite replaces those edits.
  *proposed*
- **R-u6t.** A story is kept with the design on its branch, so it's reviewed and merged with the design; a person's edits are kept the same way.
  *proposed*
- **R-n4j.** A page's build session is given its stories, edits and all, and checks the build against their acceptance criteria; where a story and the design differ, the design wins.
  *shown-on: /f/:folder/d/:design/build/stories/:group*
  *proposed*
- **R-c9r.** A story never repeats what's already built: no built rules, no pages the app already has, and no rule from another page's story.
  *proposed*
