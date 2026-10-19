# The design system and app shell say what they hold

For anyone looking down a project's designs to see how far each has got. Today the design system and the app shell are counted by their pages, as a feature is. The design system has no pages: its screens are a gallery of components. The shell's gallery is left out on purpose. So both say "nothing designed yet", or count gallery screens as pages, even when they're finished and in use. Once this is built, each one describes itself by what it actually holds. A person can then tell at a glance that they're done and don't need any more work.

## What changes

- Under Designs, the design system's line counts its components, e.g. "tokens and 24 components", rather than pages.
- The app shell's line counts its layouts, and any pages of its own beside them, e.g. "2 layouts" or "3 layouts and 1 page".
- Once the project's app exists, the shell's line also says how much of that is built: "all built", "1 built" or "none built yet". Before the app exists, it gives only the count.
- A design system with no components yet, or a shell with no layouts or pages, still says "nothing designed yet".
- Feature designs are counted by their pages, as they are today.

## Acceptance criteria

- In a project whose design system has components, its row under Designs reads "tokens and N components" (with "1 component" when there is only one), followed by when it last changed.
- A design system with no components reads "nothing designed yet".
- The app shell's row reads "N layouts". When the shell has pages of its own, the row reads "N layouts and M pages", with "layout" and "page" in the singular for one.
- When the project's app exists, the shell's row ends with "all built" when every layout and page is built. When only some are built, it ends with how many are built. When none is built, it ends with "none built yet".
- When the project's app doesn't exist yet, the shell's row gives the count alone, with nothing about building.
- A shell with no layouts and no pages reads "nothing designed yet".
- Feature designs' rows read as they do today, e.g. "4 pages, 2 approved".
- Searching or filtering the designs leaves these lines the same.

## Looks right in

- **Typical**: the design system reads "tokens and 24 components", and the shell reads "2 layouts, all built".
- **Large project**: the design system reads "tokens and 31 components", and the shell reads "3 layouts and 1 page, all built".
- **App being built** and **Update clashed**: the design system reads "tokens and 18 components". The shell is on a branch, so it's under In progress and not in this list.
- **Long names**: the design system has no components yet and reads "nothing designed yet".
- **New project**: no designs yet, so the first-run page shows and nothing here changes.

The approved screens in the snapshots for these states were taken before this change, and they still show the system and shell as "3 pages, all built". Check against the wording above until the snapshots are taken again.

## For developers

- Addresses: `/f/:project` (view `projects/page`) and `/f/:project/designs` (view `projects/_designs`, the Designs region that search and the filter reload). Both use data `projects/:project`. Only `_designs` changes; `page` includes it and is otherwise the app's own.
- In `_designs`, `progress(design)` gains two branches:
  - `kind: "system"` reads `components`.
  - `kind: "shell"` reads `layouts`, `layoutsBuilt`, and its own `pages`/`built`. Whether the shell's built count is shown depends on `app.status === "built"`.
- The model: `progressOf()` in `server/project.js` gives a system `components` (counted from its `system/components/*.html`). It gives a shell `layouts` and `layoutsBuilt`: layouts that have been ported, with `unbuiltLayouts` saying which haven't. The shell's `pages` are its own non-gallery pages.
- Test data, in `prelude/project-landing-page/states/`:
  - `01-typical.json`: a system with 24 components; a shell with 2 layouts, 2 built.
  - `06-large-project.json`: a system with 31 components; a shell with 3 layouts and 1 page, all built.
  - `03-app-being-built.json` and `04-update-clashed.json`: a system with 18 components; the shell is on a branch.
  - `05-long-names.json`: a system with 0 components.
  - `02-new-project.json`: no designs.
- The snapshots in `prelude/project-landing-page/snapshots/` predate this change. Run the snapshots again for these states once it's built.
