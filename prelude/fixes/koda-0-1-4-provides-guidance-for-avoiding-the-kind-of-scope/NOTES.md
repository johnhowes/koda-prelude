# Koda 0.1.4's warnings - notes

## The problem

Koda 0.1.4 can say when an answer lands somewhere other than where its request
was routed (a fragment in the main window), and why. It only works that advice
out on a page that asks for it, by having an `<ol ko-warnings>`; otherwise the
mistake is silent. Prelude had no such list, in its own pages or in a design's
preview.

## The cause

- Prelude's checkout still had Koda 0.1.2 installed, though `package.json`
  pinned 0.1.4 (the person ran `npm install`).
- No page asked for the warnings. A design's page renders in a frame on its own
  origin and starts Koda itself, so a list in Prelude's shell can't see its
  warnings.

## The change

- **Prelude's shell** (`prelude/prelude-shell/layouts/_regions.eta`,
  `shell.css`, and the app's copies `server/views/_regions.eta`,
  `server/public/shell.css`): `<ol id="warnings" ko-warnings>` at the window's
  bottom-start corner, hidden while empty, with a Clear.
- **The preview** (`server/host.js`): `WARNINGS_SCRIPT`, added to each page a
  design's origin serves into a frame (beside `WHERE_SCRIPT`). It adds a hidden
  `[ko-warnings]` if the page has none, cancels each `koda:warning` and posts
  it to the parent as `prelude:warning`. `server/views/_surface.eta` adds it to
  the shell's list, as "In the design's page: …". So every project's designs
  are covered, and no design's layouts (which become an app's production
  layouts) need a list.
- Not changed: the shell template the agent writes for other projects
  (`server/agent.js`), since a production page shouldn't carry the list.

## What to check

- Run `node --test test/host.test.js` (new test: "a framed page asks Koda for
  its warnings and sends them to the surface"), then `npm test`.
- In Prelude, make a redirect land outside its panel's scope (or run
  `document.dispatchEvent(new CustomEvent('koda:warning', { bubbles: true,
  cancelable: true, detail: { code: 'test', message: 'hello' } }))` in a framed
  design's console): the warning should appear at the bottom-left, and Clear
  should hide it.
- Whether the list's place and look suit you (bottom-left, `--danger-soft`);
  that was my choice, not a design session's.
- Apps already built from designs pin their own Koda: bump `@kodalang/core` to
  0.1.4 in each one's `package.json` and run `npm install` there. New builds
  pin the version Prelude has installed, which is now 0.1.4.
