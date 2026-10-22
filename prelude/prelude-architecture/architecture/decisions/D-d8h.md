# The desktop app is a window on the server
status: accepted
date: 2026-10-14
parts: desktop, server

## Context
Prelude should work in any browser, but a native window gives a folder picker, real pop-out windows and remembered window sizes.

## Decision
The Tauri shell holds no state: it uses a running server, or starts `node start.js` and stops it on quit. It injects `window.preludeDesktop` on the server's origin only, with a few commands, and shell-only controls are marked `data-desktop-only`.

## Consequences
Every native feature has a web fallback, and the server is the same either way. The shell builds separately with Rust.
