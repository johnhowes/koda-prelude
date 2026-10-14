# Prelude — plan

A tool for designing (and later building) apps with an agent. Built with Koda.
It starts as the smallest thing that works: **pick a folder, chat with an agent,
watch the design appear.** Features are added only after we've decided where they fit
in that model.

## The model

There are four nouns, and nothing else until a new one earns its place.

| Noun | What it is | Where it lives |
| --- | --- | --- |
| **Folder** | The working directory you chose, usually a repo | anywhere on disk |
| **Design** | A named body of work (screens + notes) built up over many sessions; usually one feature | `prelude/<design>/` |
| **Session** | One conversation with the agent, contributing to one design | `prelude/<design>/sessions/<id>/` |
| **Screen** | One page of the design | `prelude/<design>/screens/NN-name.html` |

The interface has two surfaces, modeled on OrchestratR's design session:

- **Chat**: the current session's transcript, with filters, the message box, and a
  session switcher ("New session" starts another). Any session can be continued on
  the machine that started it.
- **Design**: the preview, with a screen picker, Refresh, Open in browser and Pop out.

Pop out moves the Design surface to its own window, so one window holds the chat and
the other holds the design.

## Ground rules

1. **The folder is the database.** Everything Prelude produces is a file under
   `prelude/`, committed alongside the code. Prelude keeps only machine-local
   conveniences (such as the recent-folders list) in `~/.prelude/`. Nothing is lost if
   you delete that folder.
2. **Screens are plain HTML + CSS for now.** There is no custom template language and no
   target-stack rendering. Representing screen *states* will soon force a decision to
   move beyond plain HTML (see step 6). We'll make it then, deliberately.
3. **The agent uses ordinary file tools.** The agent is the Claude Code CLI, run in the
   folder with Read/Write/Edit/Glob/Grep. Its writes are limited to `prelude/<design>/**`.
   There are no MCP domain tools, because the agent can simply read the files.
4. **The design's memory lives in its files, not in a conversation.** Because a design
   spans many sessions, each new session starts from the design's files: the screens and
   `NOTES.md`. It does not start from previous transcripts. The agent keeps `NOTES.md` up
   to date as it works.
5. **The server is the single source of truth for live state.** Every window, whether
   chat, pop-out or browser tab, renders from the server and subscribes to it over SSE.
   No window holds state another window needs.
6. **Every native feature has a web fallback.** The Tauri shell makes things nicer. It
   never makes them possible.
7. **Design for sharing, don't build it.** Screens use only relative links, so a design
   folder can be served by any static host as-is. The preview URL is stable
   (`/d/<design>/<screen>`), and the viewer is separate from the editor UI.
8. **Committed files must merge cleanly.** Several people may work on the same design in
   different branches, so:
   - session folders are named so they never collide: `<yyyymmdd-hhmm>-<short-random>`;
   - transcripts are append-only;
   - there's no shared index file that every session rewrites.

## Designs, features and areas

**A design is usually a feature, but Prelude doesn't model "feature".** Name a design
after the feature it describes. There is no separate feature record, no registry, and no
link to a tracker. That keeps room for the cases that don't fit one-to-one: a design that
explores two alternatives, a design spanning features, or an early design whose feature
doesn't exist yet. If we later tie designs to tracker items, it's one optional field in
`design.json` (e.g. `"workItem": "…"`), not a new noun.

**Areas are just folders.** A design is any folder under `prelude/` that contains a
`design.json`, found by scanning `prelude/**/design.json`. So grouping by area costs
nothing and needs no concept:

```
prelude/
  onboarding/                    an area: just a folder, no file of its own
    sign-up/design.json          a design
    invite-teammates/design.json
  billing-redesign/design.json   a design with no area
```

A design's id is its path relative to `prelude/` (`onboarding/sign-up`), and that path
is also its URL (`/d/onboarding/sign-up/…`). The folder page groups designs by their
parent folders. Nothing else knows areas exist. A design folder can't contain another
design (designs don't nest), so the scan stops at the first `design.json` on each path.

## Folder layout (inside the chosen folder)

```
prelude/
  design-system/                 optional, step 5
  <design>/
    design.json                  { title, createdAt }
    NOTES.md                     agent-maintained: intent, decisions, open questions
    styles.css                   styles shared across this design's screens
    screens/
      01-sign-in.html
      02-dashboard.html
    sessions/
      20261014-1530-k3f9/
        session.json             { title, claudeSessionId, startedAt, updatedAt }
        transcript.jsonl         one normalized event per line (user, text, tool, error)
```

`claudeSessionId` lets *this machine* resume a session's conversation with
`claude --resume`. Claude's own session store is machine-local, so on another machine a
past session is read-only: you can read its transcript, and continuing means a new
session, which picks up from the design's files (ground rule 4). That's consistent with
sharing later.

## App layout (this repo)

Modeled on KodaDesign's useful bones, at a fraction of its size:

```
package.json              type: module; deps @kodalang/core (pinned), eta
start.js                  starts the server
server/
  main.js                 HTTP, routing, "one URL, two shapes"
  folders.js              open/recent folders
  designs.js              list/create designs (design.json)
  sessions.js             read/write session.json + transcript.jsonl
  agent.js                spawn claude, normalize stream-json, resume
  live.js                 SSE channels (transcript, screens, current screen)
  preview.js              serve prelude/<design>/** with live reload
  views/*.eta
  public/                 css, koda boot, icons
tauri/src-tauri/          native shell (step 4)
.claude/skills/koda-*     copied from @kodalang/core
CLAUDE.md
```

## Steps

Each step ends with something usable, and stops there for a look before the next one.

### Step 0: Skeleton
- A Koda server on one port that serves a home page.
- Home: "Open a folder" (a typed path in the web client) plus a recent-folders list.
- Folder page: the list of designs in `prelude/`, plus "New design" (asks for a title,
  creates `prelude/<design>/design.json`).
- Copy the Koda skills and write CLAUDE.md with the ground rules above.
- **Done when:** you can open a folder, create a design, and see it listed.

### Step 1: Chat
- Opening a design shows its latest session, or starts a new one when there are none.
  "New session" is always one click away. The session switcher lists past sessions,
  newest first.
- `agent.js` spawns `claude -p --output-format stream-json --verbose --include-partial-messages`
  with:
  - the folder as cwd;
  - the design system prompt, via `--append-system-prompt`;
  - file tools only, with writes allowed to `prelude/<design>/**`.

  The first turn uses `--session-id`; later turns use `--resume`. This is KodaDesign's
  `agent/runner.js`, minus MCP.
- The system prompt tells the agent to read `NOTES.md` and the screens first, and to
  update `NOTES.md` before ending each turn.
- Stream events go to `transcript.jsonl` and out over SSE to the chat surface.
- One turn runs at a time *per design* (sessions on the same design never write at once),
  with a Stop button.
- Transcript filters: start with just *Agent* and *Tools*. Add more only when they're
  missed.
- **Done when:**
  - you can hold a multi-turn conversation, close the app, reopen the folder, and pick
    up where you left off;
  - a second session on the same design knows what the first one decided.

### Step 2: Design preview
- `preview.js` serves `prelude/<design>/**` statically at `/d/<design>/…`.
- `fs.watch` on the design folder pushes `screens-changed` over SSE. The preview iframe
  reloads and the screen list updates (the "N screens" count).
- Design bar: screen picker, Refresh, Open in browser.
- The prompt tells the agent the screen conventions (numbered files, shared `styles.css`,
  relative links between screens).
- **Done when:** you ask for a screen and watch it appear and update as the agent edits.

### Step 3: Pop out (web)
- Pop out opens `/f/…/<design>/view` with `window.open`. This is the Design surface
  alone, full window.
- The current screen is server state. Changing it in either window broadcasts to both.
  The inline surface shrinks to a slim strip while popped out, as in OrchestratR.
- **Done when:** chat is in one window, design in another, and they stay in step.

### Step 4: Native client (Tauri)
- Start from KodaDesign's `tauri/src-tauri/main.rs`, keeping only: server selection, the
  origin-guarded bridge, and `open_window`.
- Native adds a real folder-picker dialog and a real pop-out window that remembers its
  size and position and can sit on a second monitor.
- The page shows native controls only when the bridge exists, and falls back to step 0
  and step 3 behavior otherwise.
- **Done when:** the same pages run in the browser and in the shell, and the shell's
  pop-out is the nicer one.

### Step 5: Design systems (first cut)

**The idea: a design system is a design.** It gets no new noun and no new screen. A
system is a design whose `design.json` says `"kind": "system"`. Everything else about
it is what a design already has:

- **Sessions** are where you shape it: "draft our system from the app's existing
  CSS", "make the buttons denser".
- **Screens** are its gallery (`01-tokens.html`, `02-components.html`, …), which the
  agent keeps current. You watch them in the same Design surface and can pop them out.
- **`NOTES.md`** holds its decisions.

What a system adds is one folder, `system/`, which other designs link to:

```
prelude/design-system/            a design, with "kind": "system"
  design.json  NOTES.md  sessions/  screens/   (as any design)
  system/
    tokens.css          role-named tokens (--bg, --accent, …), each colour written
                        with light-dark(), in @layer tokens
    components.css      the classes, built from the tokens only, in @layer components
    components/<name>.html   the canonical markup for each component, with a
                        comment saying when to use it: what the agent copies
    guidelines.md       the rules: rule, reason, do and don't; the product's words
                        and the words to avoid
    icons/<meaning>.svg + icons.css   optional
```

It is a subset of KodaDesign's format, translated for plain HTML screens:
- **Dropped:** the template dialect, props and variants JSON, releases and semver,
  `extends`, behaviours, interaction checks and the Razor form.
- **Kept:** tokens, components, guidelines, the lexicon (folded into
  `guidelines.md`) and icons.
- **Tokens:** CSS is the source, not `tokens.json`. Screens consume CSS, and the agent
  edits CSS well.

**Using one.** With one system per folder there is nothing to pick: every design in
the folder uses the folder's system, if it has one. A design page shows which, as a
link to the system ("Uses Acme's design system"). A second system in the folder is
refused when it's created. If several systems per folder are ever needed, this is
where a picker would go, recorded in `design.json`. When a design has a system, the
agent's prompt says to:
- read `guidelines.md` and `components/` before designing;
- link `tokens.css` and `components.css` from every screen;
- use the system's classes and markup;
- write no literal colours;
- note in `NOTES.md` anything the system lacks. It doesn't edit the system from
  another design: that's work for a session on the system itself.

**Where systems come from.** No import feature is needed: the agent can read the repo.
- Start blank: New design → "This is a design system".
- Draft from the app: in a session on the system, ask the agent to harvest the
  existing CSS and markup.
- Draft from another repo, such as "base it on Spark's CSS": add that repo as a
  reference folder (below), then ask.
- Prelude's own design system (KodaDesign's v1) is not offered as a starter for now.
  Anyone who wants it can add it as a reference folder and ask.

**Reference folders: what the agent may read.** Found while planning this step:
the agent's Read, Glob and Grep weren't scoped, so it could read any file on the
machine. Writes were always fenced to the design. Reads become fenced too:
- **By default:** the chosen folder only.
- **Plus reference folders**, added per folder on the folder page: "Also reads: Spark
  ✕ · Add a folder…", using the native picker in the desktop app or a typed path in
  the browser.
- The agent gets them with `--add-dir`, read-only permission rules for those paths
  alone, and one line in its prompt naming them.
- **Machine-local:** stored in `~/.prelude/`, keyed by folder, never in `prelude/`.
  They are paths on this machine, so committing them would mean nothing to anyone
  else.
- A design's `NOTES.md` can still say "based on Spark's CSS" in words.

**Needed first: the preview URL must mirror the folder.** Today a design's files are
served at `/f/<fid>/d/<design>/files/…`. A screen in one design can't reach another
design's `system/` with a relative link that would also work on a static host. Serve
the whole `prelude/` folder on the preview host instead, at `/f/<fid>/p/<path>`. Then
`../../design-system/system/tokens.css` from `prelude/checkout/screens/01.html`
resolves the same in Prelude and when shared (ground rule 7). `sessions/` stays
unserved.

**Sub-steps**, each usable on its own:
0. **5.0:** Fence the agent's reads to the folder, and add reference folders. This
   comes first because it closes a gap that exists today.
1. **5a:** The preview URL mirrors `prelude/`. This is a refactor of step 2's route.
2. **5b:** `"kind": "system"`:
   - the New design checkbox;
   - a system's own prompt (keep `system/` and the gallery in step);
   - lifting the `design-system` reserved name;
   - systems marked in the folder list.
3. **5c:** Designs use the folder's system: the "Uses … design system" link, and the
   using-a-system prompt.
4. **5d:** The optional starter, and docs.

**Done when:** you can draft a system from an existing app's CSS in one session, pick
it for a design in another, and see the design's screens come out in the system's
look.

**Deferred:** more than one level of systems (themes extending a base), sharing a
system across repositories, versions, and checking screens against the system on
save (reusing KodaDesign's `ds-classes.js` idea).

Decided 2026-10-14:
- A system is a design.
- The preview URL mirrors `prelude/`.
- One system per folder for now.
- No built-in starter; other repos' CSS is reached through reference folders.

As built:
- **Rules from Koda's `koda-styling` skill**, written into the system's prompt:
  - one layer order, first in every `system/` CSS file;
  - role-named tokens, with colours written once with `light-dark()` and literals
    only in the tokens layer;
  - components built from tokens alone, laid out with container queries;
  - icons as one SVG per meaning, drawn with a mask, with `forced-color-adjust: none`.
- **One deliberate deviation:** Koda's icon tokens use root-relative URLs
  (`/ds/v1/icons/close.svg`), but a Prelude system has to work at whatever path it is
  served from. So icon tokens use URLs relative to `system/icons.css`, and every rule
  that uses them stays in that file, where relative URLs resolve. A design never
  redefines `--icon-*`.
- **No versions yet**: one system, linked directly (Koda's `/ds/v1` versioning is
  deferred).

### Step 6: Screen states (the decision to move beyond plain HTML)
Expected soon after step 2, since real screens have states: empty, loading, error,
filled. This step is a decision before it is any code. Options to weigh then:
- **Separate files per state:** `screens/03-list.empty.html`. Stays plain HTML but
  duplicates markup.
- **One file plus state data:** HTML with a tiny templating layer, plus a
  `03-list.states.json`, as OrchestratR does. Adds a renderer.
- **One file with state attributes:** e.g. `data-state="empty"` sections, toggled by a
  state picker. Stays plain HTML, adds a convention.
- **The folder's own stack.** Real components, with the design closer to production.
  This is where "build" begins.

The state picker joins the screen picker on the Design bar. Whatever we choose must keep
designs static-servable (ground rule 7).

### Step 7 and later: candidates, each to be fitted into the model first
- **Sharing:** publish a snapshot of `prelude/<design>/` + its design system as static
  files (an Artifact, a static host, or a tunnel to the preview route). It needs only
  read-only viewer routes, which step 2 already shapes.
- Flow map, captures/annotations.
- Hand-editing a screen in place.
- Ending a session with a summary appended to `NOTES.md`, optionally committing.
- **Build:** a session kind that implements the design in the folder's real code. This is
  the "design → build" evolution.

## Explicitly not now

Accounts and sign-in, a database, git worktrees and branches per session, multi-user
presence, comments, the custom dialect, target-stack rendering, MCP tools, specs, rules,
epics, tracker integration, test generation.

## Decisions made

- 2026-10-14: The output folder is `prelude/`. It is visible and committed alongside the
  code.
- 2026-10-14: A design spans many sessions. Continuity comes from the design's files
  (`NOTES.md` + screens), not from transcripts.
- 2026-10-14: A design usually corresponds to a feature, but "feature" isn't modeled.
  Areas (OrchestratR's and KodaDesign's "surfaces") are optional parent folders, with no
  schema of their own.
- 2026-10-14 (step 1): Agent replies stream as they're written, into a live entry
  that's replaced by the finished message, rendered on the server with Koda's own
  `renderMarkdown` (it escapes raw HTML and keeps only safe link schemes). Only
  finished messages are saved. The transcript is pinned to the bottom with a
  reversed-column scroller, not a script.
- 2026-10-14 (step 1): Folder paths are stored in canonical long form. A Windows short
  name (`JOHNHO~1`) stopped the agent's path-scoped write permission from matching.
- 2026-10-14 (step 2): Design files are served on their own origin,
  `preview.localhost` on Prelude's port. They are not sandboxed, because a sandboxed
  screen loses localStorage and same-origin fonts. Every POST must come from Prelude's
  own origin, which refuses screens and other sites alike.
- 2026-10-14 (step 2): The design surface is a Koda region that re-renders itself on a
  `design-changed` event. The server sends that event when the design folder changes
  (changes under `sessions/` are ignored).
- 2026-10-14 (step 3): The current screen and the count of open pop-out windows are
  server state, held in memory per design (`server/design-state.js`) and never
  written to the folder. Every change to them is announced as `design-changed`, so
  every window re-renders from the server.
- 2026-10-14 (step 3): Following a link inside a screen changes the screen on show.
  The preview host sees the frame load the new screen (`sec-fetch-dest: iframe`), so
  nothing has to be injected into the screen.
- 2026-10-14 (step 3): In the browser, Pop out is a link with a named target, so the
  browser reuses one window per design. A pop-out window connects to the design's
  channel as a window. While one is connected, the inline surface becomes a strip,
  and it comes back when the window's channel closes.
- 2026-10-14 (step 4): The Tauri shell (`tauri/src-tauri`) is a window on a Prelude
  server and starts none. It injects `window.preludeDesktop` on the server's origin
  only, with three commands:
  - `pick_folder`: a native dialog;
  - `pop_out`: one real window per design, brought forward if already open, which
    can only open this server's `…/window` pages;
  - `open_in_browser`: this server's or the preview host's pages only.

  `tauri-plugin-window-state` remembers each window's size and position, keyed per
  design. The page side is one relay script (`server/public/desktop.js`).
  Shell-only controls are marked `data-desktop-only`, and in a browser the links
  work as links.
- 2026-10-14: Screens start as plain HTML. The move beyond it is deferred to step 6
  (states).
