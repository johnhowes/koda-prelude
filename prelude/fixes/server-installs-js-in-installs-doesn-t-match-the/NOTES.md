# server/installs.js, in Installs, doesn't match the architecture - notes

## The problem
The architecture check reported "Installs names server/installs.js, which isn't there."

## The cause
D-k7v (the agent follows the app's own Koda) set the architecture as the target before any of its code existed. The architecture was right; the code was missing. That was all of D-k7v, not just this file: Prelude pointed every agent and every design at its own Koda.

## The change
The person asked for the whole of D-k7v to be built, with minor changes to the project page allowed.

- **Installs** (`server/installs.js`, new): the one place Prelude runs a package manager.
  - It picks npm, pnpm or yarn from the lockfile.
  - It builds the command itself: install `@kodalang/core@<exact version>` and nothing else.
  - It runs only in the project's own folder or a worktree `branches` made.
  - It runs only after `approve()`, has a 5-minute limit, and keeps its output.
  - In a worktree it saves the exact version. In the checkout npm runs `--no-save`.
  - `commandFor()` gives the command to show before anyone clicks.
- **Designs** (`server/app-config.js`):
  - `appDirOf` finds the app's folder.
  - `kodaOf` reads the Koda installed there (app folder, then root) and what package.json asks for.
  - `findKoda` returns the first of several roots that has it installed.
- **Server** (`server/main.js`):
  - `kodaFor()` finds the app's Koda: the worktree, then the checkout, then Prelude's.
  - Every prompt's `kodaPath`, and the Koda reference folder, now use it.
  - The design host serves its runtime at `/_prelude/koda/`.
  - New `POST /f/:id/koda/upgrade` makes the fix "Upgrade Koda to <v>" on its own branch, writes its NOTES, installs the version there and commits package.json and the lockfile when the install finishes (unless a turn is running, whose commit takes them). It then opens the fix's page.
  - New `POST /f/:id/koda/install` installs what package.json asks for in the checkout.
  - Both do only what the card offers at that moment.
- **Design host** (`server/host.js`): serves `kodaDirOf(folder)` instead of one fixed folder.
- **Page models** (`server/project.js`): `kodaModelOf()` builds `app.koda` on the built app's card: upgrade offered, upgrade in progress, install offered, installing or failed.
- **Project page**:
  - `server/views/projects/_app.eta` shows those, each with the command it runs.
  - The design (prelude/project-landing-page) gained the typical state's upgrade offer, the two POST routes and a NOTES section.
- Tests: `test/installs.test.js`.

## What to check
- Run `node --test test/installs.test.js`, then `npm test`.
- The project page's typical state now shows "Upgrade Koda" on the app card, so its approved screens will differ there. That's on purpose.
- Open a project whose app is on an older Koda. Click Upgrade Koda, check the fix opens, and check that after the install its branch has package.json and the lockfile committed.
- pnpm and yarn have no "don't save" flag. In the checkout they write back the version the merge already put in package.json.
- The design host serves the folder holding the app's Koda entry file, and the page loads `koda.js` from it. An older Koda whose entry file isn't named `koda.js` wouldn't load there.
- Installs are kept in memory: a restart forgets a failed install's log, and the card just offers it again.
