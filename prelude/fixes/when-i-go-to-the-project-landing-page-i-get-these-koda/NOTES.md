# Koda warnings on the project page and the Ask or fix page

## The problem
The browser console showed Koda warnings:
- On the project page: `"q" is declared 2 times in one ko-item`, and `"q"` / `"stageReady"` / `"stageDesigning"` "inside this ko-item is not the #… on the page".
- On the Ask or fix page: `"message" is declared 2 times in one ko-item`, `"message" … is not the #message on the page`, and an answer for `#app` that was dropped.

## The cause
- Most were false warnings from Koda 0.1.4. An element whose `id` and `name` are the same (`<input id="q" name="q">`) was counted twice. A name found inside a `ko-item` was reported as hiding the page's `#id` even when it was that same element. Koda 0.1.5 fixes both.
- One was real. In `server/views/_composer.eta`, the hidden input that copies the message into the draft had `name="message"` and no `ko-as`, so it declared `message` a second time next to the textarea (`ko-as="message"`). The textarea came first, so everything still worked.
- The dropped `#app` answer is expected. `#app` reloaded on a live event just as the page was being replaced, so Koda dropped the stale answer instead of attaching it to an element that was gone.

## The change
- Upgraded `@kodalang/core` from 0.1.4 to 0.1.5 (`package.json`, `package-lock.json`). The lockfile has no `integrity` for 0.1.5 yet; `npm install` adds it.
- `server/views/_composer.eta`: the draft's hidden input now has `ko-as="draftMessage"`. It still posts as `message`, and `message` now names only the textarea. There's no visible change.
- `test/chat.test.js`: a test that the composer's draft copy has its own name.

## What to check
- Run `npm install`, then `npm run skills` (it copies Koda's skills into `.claude/skills/`), then commit the lockfile with its new `integrity` line, and the skills if they changed.
- Run `npm test` (the new test is in `test/chat.test.js`).
- Open a project page and the Ask or fix page with the console open: the `q`, `stageReady`, `stageDesigning` and `message` warnings should be gone. Search and filter the designs, then type in the message box, reload, and check that the draft is kept.
- Approved screens of Design Workspace and Fix Something will differ by the one new `ko-as` attribute on the hidden draft input. That's on purpose.
