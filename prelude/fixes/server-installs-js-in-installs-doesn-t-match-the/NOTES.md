# server/installs.js, in Installs, doesn't match the architecture - notes

## The problem
The architecture check reported "Installs names server/installs.js, which isn't there."

## The cause
D-k7v (the agent follows the app's own Koda) added the `installs` part as the target, before any of its code existed. The architecture was right; the code was missing.

## The change
- New `server/installs.js`, the Installs part. It's the one place Prelude runs a package manager:
  - picks npm, pnpm or yarn from the lockfile (the app's folder first, then the root)
  - builds the command itself: install `@kodalang/core@<exact version>` and nothing else. It refuses ranges, tags and anything with extra words
  - runs only in the project's own folder or a worktree `branches` made for it. It finds the app inside that folder from prelude.json's app path
  - `plan()` returns the command for the person to see. Nothing runs until `approve()`. `decline()` drops it
  - a 5-minute time limit, stops the whole process tree, and keeps the output (`status().log`) for the chat
  - in a worktree it saves the exact version, so the fix commits package.json and the lockfile. In the checkout npm runs with `--no-save`, so only node_modules changes
- New `test/installs.test.js`.
- `prelude/prelude-architecture/NOTES.md`: the "until it's built" line now says what's built and what isn't.

No design, page or route changed. Nothing calls Installs yet.

## What to check
- Run `node --test test/installs.test.js`, then `npm test`.
- pnpm and yarn have no "don't save" flag. In the checkout they write back the version the merge already put in package.json. Check that's acceptable, or limit checkout installs to npm.
- Still to build for D-k7v: `designs` finding the app's Koda and its versions, the server passing that Koda to prompts and starting installs, the host serving its runtime, and the project page's "Upgrade Koda" and "install it here" offers. Those offers change the project page, so they need a design session on Project Landing Page first.
