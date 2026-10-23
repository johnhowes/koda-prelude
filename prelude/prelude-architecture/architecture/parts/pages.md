# Page models
layer: Pages
kind: module
short: Home, project, design, build pages
files: server/home.js, server/project.js, server/workspace.js, server/build.js, server/check.js, server/system.js, server/plans-page.js
uses: architecture, turns, views, stories, host, branches, designs, sessions, folders, preview, words, plans

The models behind Prelude's own pages, each shaped like the states of the design it was built from: Home, a project's page, a design's page (`DesignPage`), the Build page and its stories, the check's results and the design system page. They're read afresh from the project's files on every request.

## Responsible for
- What needs the person, and where each design stands
- A design's sessions, rules and approved screens, as words for the page
- The Build page's groups, stories and the after-turn check's results
- Where a plan's steps stand, which of them start here, and its session as its chat
- Comparing the app's Koda version with Prelude's and offering the upgrade, then offering to install it in the checkout once merged

## Not its job
- Markup (the views) or routing (the server)
- Changing the project's files, beyond stories and check results

## Owns
- `stories/<page>/` in a design, and each session's `check.json`
- Seen times for Home's needs
