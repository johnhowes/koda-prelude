# The "Open the Pull Request" links don't seem to work, at least from the desktop app

## The problem

In the desktop app, clicking "Open the pull request" (on a branch's row, after
pushing, and in a folder's published notice) does nothing. In a browser the
links work.

## The cause

In the desktop app, `server/public/desktop.js` takes over every
`a[target="_blank"]` link and hands the address to the shell's
`open_in_browser` command, so it opens in the system browser. That command
(`tauri/src-tauri/src/main.rs`, `may_open_in_browser`) only accepted the
server's own origin and `preview.localhost`. It was written for "Open in
browser", so it refused a GitHub address. The click had already been
cancelled, and the refusal only went to the console, so nothing happened.
Other links that point off the server, like "Needs you" items, failed in the
same way.

## The change

- `tauri/src-tauri/src/main.rs`: `may_open_in_browser` now also accepts any
  `https` address. Plain `http` is still accepted only for the server and its
  preview, and every other scheme (`file:`, `ms-settings:`, …) is still
  refused. The test is now `the_browser_opens_this_server_its_preview_and_https_only`.
- `server/public/desktop.js`: if the shell refuses an address, the link opens
  with `window.open` (as an ordinary link would) instead of doing nothing.

No design changes: the pages look and behave as designed. Only the desktop
app's handling of the click changed.

## What to check

- Run the shell's tests: `cargo test` in `tauri/src-tauri`. Also run
  `npm test`, which is unchanged but serves `desktop.js`.
- Rebuild the desktop app (the shell is Rust, so it needs rebuilding before
  it changes). Push a branch, then click "Open the pull request" on its row
  and in the "Pushed …" notice. GitHub should open in your system browser.
- "Open in browser" and Pop out should work as before.
