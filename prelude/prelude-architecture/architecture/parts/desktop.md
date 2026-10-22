# Desktop shell
layer: Windows
kind: process
short: Tauri window on the server
files: tauri/src-tauri/**, server/public/desktop.js
uses: server

The Windows desktop app, built with Tauri: a window on a Prelude server. It uses a server already answering `/health` on localhost:4200, or starts `node start.js` itself and stops it on quit. `server/public/desktop.js` relays the page's calls to its native commands.

## Responsible for
- The native folder picker, pop-out windows (one per design) and opening pages in the browser
- Remembering each window's size and position
- Starting and stopping the server when none is running

## Not its job
- Any state or page of its own: everything it shows comes from the server
- Anything a browser can't also do another way

## Owns
- `dist-shell/Prelude.exe` and its window-state store
- `~/.prelude/server.log` when it starts the server
