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
  Rust tests. The app is a window on the server: it uses one already answering
  `/health` on localhost:4200 (`npm start`), or else starts `node start.js`
  itself (Prelude's folder is found above the exe, or `--root`/`PRELUDE_ROOT`;
  its output goes to `~/.prelude/server.log`) and stops it on quit. `--server
  <url>` or `PRELUDE_URL` points it elsewhere and starts nothing. If the
  machine is short of memory, build with `cargo build --release -j 1`. To inspect its windows,
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
    `it.regions`. POST routes (`readPostRoutes`, `postPath`) update, add or
    remove at a data path, refuse empty required fields with a 422, and answer
    with a redirect or a fragment plus `ko-into` envelopes. They change a
    working copy of the state (`copy` in design-state.js), never the files.
    GET routes may filter by the query (`search`, `match`, `list`; `filterModel`),
    and every view sees the query as `it.$query`. `/_prelude/` on that origin serves Koda, the system, the shell and
    the design's files.
  - Views are agent-written code, so they render only in `server/renderer.js`:
    a separate process under Node's permission model (`server/renderers.js`)
    that may read the folder and Prelude, and nothing else. Never render a
    design's views in the server's own process.
  - After each turn on a design of views, `reviewDesign` (host.js) renders every
    route in every state; failures show in the chat and are prepended to the
    agent's next message (`withFindings` in turns.js). The agent can't see the
    preview, so this is how it learns a view doesn't render.
  - `server/hosts.js` is the host contract for other stacks (plan, 6c). A
    folder whose `prelude/prelude.json` names a `host` renders through it, over
    HTTP, instead of through the Eta renderer; host.js does everything else as
    before and proxies the app's assets to it. A host runs views unsandboxed, so
    it starts only once the person approves it for that folder
    (`~/.prelude/approvals.json`, tied to the host settings) and is stopped with
    Prelude. `tools/reference-host.js` is the contract in a page of Node (and
    what the tests start).
  - Porting (plan, 6d): a route's view may be `@app/<path>`, the app's own file
    (`viewOf` in host.js), and the design's states become its fixtures.
    `server/snapshots.js` keeps a design's approved screens in `snapshots/`,
    compared as normalised HTML; the after-turn check lists pages that differ
    (to the person, not the agent). `npm run check <folder>` runs the whole
    check for CI, exiting 1 on a failure or a difference; `-- --approve`
    approves instead.
  - Build (plan, step 7): `server/rules.js` reads a design's `RULES.md`;
    `server/backlog.js` derives what's left to build, by page, and the story
    text (the Build view, `_build.eta`). A build session is a session whose
    `session.json` has `build: { group, title }`; it runs in `mode: 'build'`
    (`buildPrompt`, `permissionArgs`). A host's `x-prelude-ahead` header (state
    members a typed model lacks) is reported, never failed.
  - Branches (plan, step 9): in a git repository every design works on its
    own branch, `prelude/<design>`, in a worktree (`server/branches.js`, kept in
    `~/.prelude/builds.json`). A worktree is a folder (`app.folders.get` finds
    it; `folder.branch` is set), so its sessions, host and check are a folder's.
    Design and build sessions both work there and every turn is committed;
    Prelude never writes to the person's checkout. A design's page on the main
    folder moves to its worktree, and anything posted makes the branch first.
    A design's agent may also change the design system and the shell on its
    branch (`shared`). Finishing (`/f/<id>/branches/<branch>/merge|publish|update`)
    merges into main without touching the checkout, or pushes for a pull
    request (`gh`, `az`) after asking; merged branches are tidied up.
  - Stories of the increment (plan, step 10): `server/increment.js` compares a
    design on its branch with the same design where it left `main`, per group.
    `groupsOf` (main.js) makes each group new, changed, to build or unchanged;
    a changed group's story (`incrementStory`) and build brief (`buildPrompt`'s
    `change`) hold only the change. To redesign a built page the design brings
    its view back with `"from": "@app/…"` on the route; the build ports it back
    and Prelude clears `from`. The folder page's "In progress" lists the work on
    every branch, with "Copy all stories".
  - The app (plan, step 8): `server/app-config.js` reads `prelude.json`'s
    `app` (the stack chosen with the first design, and the app's path once
    built). The folder page's "The app" card starts the app build: a build
    session of the shell (group `@app`, `appBuildPrompt`) that creates the app
    as its own design host. Feature builds wait until it exists. A shell's
    `layouts.json` names layouts that are the app's files.
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
