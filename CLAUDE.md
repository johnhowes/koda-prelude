# Prelude

A tool for designing (and later building) apps with an agent: pick a folder,
chat with an agent, watch the design appear. The plan, its ground rules and
every decision taken are in `docs/plan.md`. Read it before adding a feature.
Nothing gets added until we've decided where it fits in the simple model
(folder, design, session, screen; a chat surface and a design surface).

## Koda

This application is built with Koda. Before writing or changing a view, a
stylesheet or a handler, load the matching skill - `koda-app-authoring`,
`koda-styling`, `koda-server-setup` (and `koda-composition` for anything that
crosses an application or a host) - and follow it. Look attributes up in the
Koda reference (`node_modules/@kodalang/core/docs/reference.md`, the version
Prelude depends on) rather than from memory. Run `koda-review` before calling a
change finished.

Koda is the npm package `@kodalang/core`, pinned in `package.json`, and it ships
its skills. The ones in `.claude/skills/` are copies of the installed package's;
`test/skills.test.js` fails when they differ. After upgrading Koda, run
`npm run skills` to copy them again, and read what changed.

## Working here

- `npm start` runs Prelude on http://localhost:4200 (`PORT` to change it).
  Views are cached when the server starts: restart it after changing one.
- `npm test` runs the tests (node --test). Add tests for what you build.
- The desktop app: `npm run build:shell` builds `tauri/src-tauri` (about 10
  minutes from cold) into `dist-shell/Prelude.exe`. `npm run test:shell` runs its
  Rust tests. Run `npm start` first: the app is a window on the server, and
  `--server <url>` or `PRELUDE_URL` points it elsewhere. To inspect its windows,
  launch it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  and use the DevTools protocol at `http://127.0.0.1:9333/json`.
- The folder is the database. Everything Prelude produces goes in the chosen
  folder's `prelude/` directory. The only machine-local state is in
  `~/.prelude/` (`PRELUDE_HOME` to change it; tests use a temporary one).
- Layout:
  - `server/main.js` holds the routes.
  - `server/agent.js` runs the Claude CLI and holds the design prompt and the
    permission flags. `server/turns.js` runs one turn per design at a time.
    `server/live.js` holds the SSE channels.
  - `server/sessions.js` handles `session.json` and `transcript.jsonl`.
  - `server/preview.js` lists screens, serves design files and watches design
    folders. The folder's whole `prelude/` directory is served at
    `/f/<folder>/p/<path>`, only on `preview.localhost:<port>` and never a
    `sessions/` folder, so relative links between designs work.
  - `server/designs.js` finds designs, and the folder's two special designs, one
    of each per folder: the design system (`"kind": "system"`) and the app shell
    (`"kind": "shell"`, its layouts). The agent's prompt for each kind,
    and for a design that uses the system, is `designPrompt` in `server/agent.js`.
  - The agent reads the folder, plus the reference folders added on the folder
    page (`createReferences` in `server/folders.js`, passed as `--add-dir`).
    Never add a bare `Read`, `Glob` or `Grep` to its `--allowedTools`: that
    opens the whole machine.
  - `server/host.js` is the built-in Eta host. A design with `routes.json` is
    served on its own origin, `<design>.<folder>.preview.localhost:<port>`: it
    finds each route's data in the current state's dataset (`states/`), wraps
    pages in a layout (the design's own, then the shell's, then `@app/…` in the
    repo, then `server/views/host/layout.eta`), and answers each URL in two
    shapes. An overlay route (`over`, `in`) answers a cold load with the page
    beneath and the overlay in its region; layouts print regions from
    `it.regions`. `/_prelude/` on that origin serves Koda, the system, the shell and
    the design's files.
  - Views are agent-written code, so they render only in `server/renderer.js`:
    a separate process under Node's permission model (`server/renderers.js`)
    that may read the folder and Prelude, and nothing else. Never render a
    design's views in the server's own process.
  - After each turn on a design of views, `checkDesign` (host.js) renders every
    route in every state; failures show in the chat and are prepended to the
    agent's next message (`withFindings` in turns.js). The agent can't see the
    preview, so this is how it learns a view doesn't render.
  - `server/design-state.js` holds each design's live state: the current screen,
    the version, and how many windows are open. All windows re-render on its
    `design-changed` event.
- The in-app browser pane doesn't render cross-origin iframes, so the preview looks
  blank there. To check the preview, use a real browser, or open the frame's URL
  directly.
  - In tests, `test/fake-runner.js` stands in for the CLI.
  - `server/views/` holds the views: `_name.eta` is a fragment, and `layout.eta`
    wraps it for a cold load.
  - `server/public/` holds Prelude's CSS. `ds/v1` is the design system, copied
    from KodaDesign's `packages/design/v1`.
- In Git Bash, heredocs have eaten backslashes in regexes and JavaScript strings.
  For edits with backslashes, use the edit tool.
