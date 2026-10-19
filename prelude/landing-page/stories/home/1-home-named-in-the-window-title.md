# Home named in the window title

For anyone with Prelude open next to other windows or tabs. Today the home page's window is called just "Prelude", the same as every other Prelude page, so in the taskbar, the tab strip or the browser's history you can't tell it's Home. Naming it "Home" lets people find their way back to the page that shows what needs them.

## What changes

- The window (or browser tab) showing the home page is called "Home" instead of "Prelude".
- This is true however Home looks: with projects listed, on first run with no projects yet, when nothing is waiting, and when project names and paths are long.
- Nothing on the page itself changes: the heading, Needs you, the project cards and Open a project stay as they are.

## Acceptance criteria

- Going to the home page with projects open, the window's title reads "Home".
- On first run, with no projects yet, the window's title reads "Home".
- When nothing needs the person, the window's title still reads "Home".
- With very long project names and paths, the window's title still reads "Home", and the page looks as it does today.
- Coming back to Home from a project's page, the window's title changes back to "Home".
- After removing a project whose folder has gone, Home's window title still reads "Home".

## Looks right in

- **Typical**: `prelude/landing-page/snapshots/typical/index.html`
- **First run**: `prelude/landing-page/snapshots/first-run/index.html`
- **All caught up**: `prelude/landing-page/snapshots/all-caught-up/index.html`
- **Long names**: `prelude/landing-page/snapshots/long-names/index.html`

## For developers

- Route `/` → view `@app/server/views/home/index` (`server/views/home/index.eta`, which includes `home/_home.eta`), titled "Home" in `routes.json`. The body, regions and styles already match the approved screens; only `<title>` differs.
- The title comes from `server/views/_head.eta` (`it.title ?? 'Prelude'`). `homePage` in `server/main.js` passes `title: 'Prelude'`; pass `'Home'` for the `/` view. `POST /folders` refused without script and `POST /folders/:id/remove` without script render or redirect to the same page, so they get it too.
- When Koda swaps Home in from another page (for example the brand link or the bar's Needs you link), make sure the document title follows, the same way it does for the app's other titled pages.
- Leave `/loading` (its own title in `routes.json`), `/open` and the region fragments `/home/needs-you` and `/home/projects` as they are; they aren't part of this change.
- Test data: `prelude/landing-page/states/01-typical.json`, `02-first-run.json`, `03-all-caught-up.json`, `04-long-names.json`. Each should render with the title "Home" and otherwise match its snapshot.
