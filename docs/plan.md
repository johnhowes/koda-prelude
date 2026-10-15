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
- **Later (2026-10-15): the shell starts the server.** With no `--server` or
  `PRELUDE_URL`, the shell uses a Prelude already answering `GET /health` on
  localhost:4200 (`npm start` while developing).
  - **If none answers,** it opens on its own "Starting Prelude…" page
    (`tauri/dist/index.html`), runs `node start.js` in Prelude's folder, and moves the
    window to the server once it answers.
  - **Finding Prelude's folder:** the nearest folder above the exe with `start.js`, or
    `--root` or `PRELUDE_ROOT`. Node comes from the PATH, or `PRELUDE_NODE`. The server's
    output goes to `~/.prelude/server.log`.
  - **Failures** show on the starting page, carried in its URL fragment: Prelude's
    folder not found, the port taken by something else, Node missing, or the server
    stopping or not answering within 60 seconds.
  - **On quit,** the shell stops the server it started, and its process tree with it
    (renderers, design hosts). The server also stops by itself within about two seconds
    if the shell dies (`PRELUDE_PARENT_PID`). A server the shell didn't start is left
    running.

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

### Step 6: Screens in the app's own stack, with states as fake data

Real screens have states: empty, loading, an error, a refusal, a long list, someone
without permission. A state isn't only which parts show. **It is fake data**: these
names, this many rows, this amount, this validation error. The best designs use the
app's real components fed with that data, which is what OrchestratR does through
Spark's DesignHost.

**What DesignHost shows works, and what it struggles with** (from reading
`App/DesignHost` and real designs in `features/…/design/`):
- **Works:**
  - Screens are real Razor with the real tag helpers and partials, so the output is
    byte-for-byte what production emits.
  - The handoff is "port, don't redesign".
  - An inventory script checks a design against its own porting checklist.
- **Fake data is flat:**
  - `states.json` holds only string values, error strings and boolean flags, keyed by
    dotted path.
  - Lists and nested data end up as inline C# in the screen, chosen by flags. One real
    screen has 11 states, all flags.
  - The screen binds to stand-in fields (`design-name` instead of `asp-for`) rather than
    the real view model, because a C# model needs a recompile and that kills the loop.
- **Translation is a manual port:** swap `design-name` back to `asp-for`, write the
  controller and model, re-inline partials.
- **Nothing detects drift between an approved design and the implemented page.** That
  check is listed as future work.

**The proposal: a state is a fake view model, rendered by the real view.**

```
prelude/<design>/screens/
  03-orders.<ext>              a screen in the app's own template language: its real
                               layout, components and partials (.cshtml, .eta, .tsx, …)
  03-orders.states.json        one entry per state, the first the default. Each is the
                               whole model the view receives, as structured JSON: lists,
                               nesting, numbers, dates, plus the errors to show.
```

```json
{
  "filled":  { "model": { "orders": [{ "id": "P-10482", "borrower": "Harbor Street Bakery", "amount": 250000 }, …] } },
  "empty":   { "model": { "orders": [] } },
  "long-names": { "model": { "orders": [{ "borrower": "The Very Long Business Name of Many Words, LLC", … }] } },
  "refused": { "model": { … }, "errors": { "Amount": "Enter an amount in dollars." } }
}
```

What changes compared with today's plain HTML (step 2) and DesignHost:
- **Conditions are the real component's own logic.** An empty list shows the empty
  state because the view says so, not because a flag forces it. A state proves the view
  handles that data.
- **Lists, nesting and realistic data are ordinary JSON,** with no inline code in the
  screen and no flags multiplying.
- **The state's shape is the view model's shape.** Designing the screen also designs
  the contract the controller must meet.

**How it renders: a host per stack, in the repo.** Prelude stays general-purpose by
not knowing any stack. A repository that wants real components provides a **design
host**: a small program or route that renders (screen, state) with the app's own
engine and components. It's declared in a committed `prelude/prelude.json`:

```json
{ "host": { "start": "dotnet run --project App/DesignHost", "url": "http://localhost:5100",
            "render": "/prelude/{design}/{screen}?state={state}" } }
```

- **Prelude's part:** start the host, point the preview frame at it, list each screen's
  states from `states.json` (the state picker), and reload on change as it does now.
- **The host reads `prelude/` straight from disk,** since the designs are in the same
  repository.
- **A repo without a host keeps plain HTML screens,** as now. Design systems stay plain
  HTML too: their gallery must render anywhere.

**Translating to the real app later.** The screen is already a real view and the state
is already its model, so porting is small:
1. Move the view into the app.
2. Write the controller or loader that produces the same model.
3. Keep the `states.json` entries **as test fixtures for that view**.

Nothing gets redesigned or re-marked-up. The step-2 kind of plain HTML screen, by
contrast, is a rewrite.

**Detecting drift, at three levels:**
1. **Before porting, designs track the live components:** a component change shows up
   in every design that uses it, which is the drift you want. Prelude can re-render a
   design's screens and states to show what a component change did.
2. **The contract:** a check deserializes each state into the real view-model type (C#)
   or type-checks it (TypeScript). When the model changes, the stale design states fail
   by name: "orders.amount is now a Money, not a number".
3. **The page:** after porting, the fixtures render the production view in CI, compared
   against snapshots captured from the approved design. A changed page fails with a
   visual diff. DesignHost doesn't have this yet; here it follows directly from states
   being fixtures.

**The honest costs:**
- **A design host is real work per stack:** stubbing services, authorization and data
  that views reach for (DesignHost's `DesignServiceStubs`, its "faking ladder" for view
  components). The agent can draft one in a session, but someone owns it.
- **Real view models in compiled stacks.** Binding a Razor screen to a real C# model
  type needs that type to compile. The options:
  - bind to a JSON-backed dynamic model while designing, typed at port time;
  - let the host generate model types from `states.json`;
  - keep DesignHost's `design-name` approach for Spark.

  Interpreted stacks (Eta, React, Vue, Koda) have no such problem.
- **Static servability (ground rule 7) is lost for these screens.** Sharing needs the
  host running, or Prelude saves each rendered (screen, state) as static HTML for a
  share. Plain HTML screens keep it.

**Decided 2026-10-15:**
- **A state is the view model, rendered by the real view, through the repo's design
  host.** The aim is that a design's view is the real view, so drift can't go unnoticed.
- **After porting, the design stops keeping its own copy.** Its screen points at the
  production view, and its states become that view's test fixtures, rendered in CI.
  From then on there is one view.
- **Eta is Prelude's built-in host, and the default for every repo.** A screen is an
  Eta template: `screens/03-orders.eta`, rendered with each state's model as `it`.
  - Plain HTML is valid Eta, so existing `.html` screens still work, served as they
    are.
  - For Eta and Koda repos, Prelude itself included, the screens are the real views.
  - For other stacks without a host of their own, screens still get states and fake
    data, and porting translates the markup.
- **Models are untyped while designing,** typed at port time, Spark included.

#### View decomposition: a design is the app's views, served the way the app serves them

A real screen is not one file. It's a layout around a page, partials repeated in a
list, and, in Koda, regions that load their own URL (`ko-source`), answer in place
(`ko-target`) and arrive in two shapes: the bare fragment for a region, the whole page
for a cold load. A design that flattens this into one file per screen drifts from the
first port. So a design **is** the app's views, decomposed the way the app decomposes
them, and **served the way the app serves them**, with Koda running for real in the
preview.

**What KodaDesign showed** (`docs/view-composition.md`, VC-1 to VC-4):
- **Right:**
  - a live Koda prototype with real routes;
  - one URL answering in two shapes;
  - fragments with routes of their own;
  - the same file included in a list and answering alone.
- **Heavy:** a custom template dialect; per-fragment `slice.json` and
  `examples.json` files; an `exchanges.json` with an effects language; per-viewer
  in-memory sessions; data kept per screen, so the list and the detail page could
  disagree; and an authored composition diagram on top of the markup.

**The proposal: the real view structure, a route table, and design-wide fake data.**

```
prelude/<design>/
  views/
    layout.eta               the app's layout: loads the system's CSS and Koda, owns
                             ko-scope="/" and ko-history, as the real one does
    orders/list.eta          a page
    orders/_row.eta          a fragment: included in the list, and answers alone
    orders/detail.eta
    orders/_lines.eta        a region the detail page loads by ko-source
  routes.json                the URLs the design answers, as the real app's router would
  states/
    typical.json             the default: a small fake dataset for the whole design
    empty.json               no orders at all
    long-names.json          the same shape, with the awkward data
```

```json
{
  "/orders":                  { "view": "orders/list",   "title": "Orders",  "data": "" },
  "/orders/:id":              { "view": "orders/detail", "title": "Order",   "data": "orders/:id" },
  "/orders/:id/row":          { "view": "orders/_row",                       "data": "orders/:id" },
  "/orders/:id/lines":        { "view": "orders/_lines",                     "data": "orders/:id/lines" }
}
```

How it improves on KodaDesign:
- **No dialect.** Views are Eta: `include` for partials, `layout` for layouts.
  They're the real views of an Eta or Koda app, and the closest translation for any
  other stack.
- **Fake data is design-wide.** A state is one dataset (`states/<name>.json`) that
  every route reads. The list, the detail page and every fragment agree, and flipping
  to `empty` changes the whole flow at once. There is one state picker for the
  design, not one per screen.
- **One line of mapping per route instead of slices:** `"data": "orders/:id"` walks
  the dataset, matching `:id` against each record's `id`. That's all a fragment needs
  to answer on its own.
- **One URL, two shapes, done by the host as the real server does it:**
  - a request with `x-koda-fragment: 1` gets the view alone;
  - anything else gets it inside `views/layout.eta`, with `ko-location` set;
  - every answer sends `x-koda: 1` and `Vary: x-koda-fragment`.

  So regions, `ko-source`, `ko-target` and history behave in the preview exactly as
  in the app.
- **Real URLs, on an origin per design:** each design is served at
  `<design>.<folder>.preview.localhost:<port>`, so its routes are root-relative,
  exactly the app's (`/orders/1041`). `ko-scope="/"` owns the page as it will in
  production. The design system's CSS and Koda are served under one reserved prefix
  (`/_prelude/…`) on that origin.
- **Nothing is authored twice.** Pages for the screen picker come from `routes.json`
  (routes with a `title`). Which regions a page has, and what they load, can be read
  from the markup (`ko-source`, `ko-scope`, ids) when an outline is wanted, rather than
  kept in a second file.

**Not in this step:**
- **Forms and POSTs that change the data,** and the answers that follow (refusals,
  out-of-band updates, closing a drawer). They're the next step: they need a decision
  about effects, and GET-only already gives real navigation, regions and states.
- **A drawn composition diagram.**

**How it carries into the real app:**
- For an Eta or Koda app, `views/` moves into the app's views as it is, and
  `routes.json` becomes the router.
- Each `data` path becomes the controller's query.
- The states become fixtures. Rendering each route under each state in CI is the
  drift check.
- After porting, the design points at the production views (decided above).
- For Spark, DesignHost renders `views/` as Razor with the same `routes.json` and
  states (6c).

**Sub-steps (revised):**
1. **6a:** The built-in Eta host, GET only:
   - `views/`, `routes.json` and `states/` on a per-design preview origin, with one URL
     in two shapes and Koda live;
   - the shell design (`"kind": "shell"`): layouts from it (or the design's own
     `views/layouts/`, or a minimal built-in one), with shell data from the layout's
     sample data and the state;
   - the screen picker built from routes, plus a design-wide state picker. The state is
     server state, and a frame loading a route moves every window to it.
   - Plain `.html` screens keep working for designs without `routes.json`.
2. **6a.2:** Overlays in context: a drawer, modal or side panel shown over a real
   page, not as a page of its own (below). It comes before forms, because most forms
   live in overlays and their answers depend on the page behind.
3. **6b:** Forms and changes: POST routes, what they change in the state's data, and
   their answers. Decided before it's built.
4. **6c:** The host contract for other stacks (`prelude/prelude.json`), then Spark's
   DesignHost.
5. **6d:** Drift: porting points a design at the production views, and states render
   as CI fixtures (below, decided 2026-10-15).

Decided 2026-10-15:
- A design is the app's views plus a route table, with design-wide fake data as its
  states.
- Each design gets an origin of its own, so routes are the app's real URLs.
- 6a is GET only; forms and their effects are 6b.
- One `data` path per route to start, evolving into loaders only if that runs out.

#### Layouts: the app's shell, designed once and shared

A layout isn't one design's: it's the app's shell, the page every feature lives in. It
holds the header and navigation, the main region that owns `ko-scope="/"` and
history, and the places a page may ask for (a drawer, a notice area: `drawer?`,
`notice?`). If each design kept its own copy, the designs would drift from each other
and from the app.

**Layouts belong to the app, not the design system.** The design system is a
vocabulary (tokens, components, guidelines, icons) that an organisation may one day
share across apps. Each app has its own shell. In Koda's terms the layout is the
*host*: it owns the page and offers affordances, and features render into it.

So the folder gets a second kind of special design, **the shell**: `"kind": "shell"`,
one per folder, made the way the system is (New design → "This is the app's shell"):

```
prelude/shell/                  a design, "kind": "shell"
  design.json  NOTES.md  sessions/  screens/   (its gallery: each layout with sample content)
  layouts/
    app.eta                     header, nav, <main ko-scope="/" ko-location ko-history>,
                                and the regions it offers (<aside id="drawer" ko-region>, a notice area)
    app.json                    sample data for the shell: who's signed in, the nav items, counts
    bare.eta                    e.g. sign-in or a full-screen wizard: no nav
  views/                        partials the shell's layouts share (the nav, the user menu)
```

- **The shell uses the design system** like any other design. If an organisation's
  system arrives later, the shell and the designs move to it; their layouts don't.
- **Designed in the shell's own sessions** ("add a notifications bell to the header"),
  and shown in its gallery: one screen per layout, showing each region it offers.
- **Designs use it by name:** a route says `"layout": "app"`, the default, or
  `"bare"`. A design never copies a layout. Like the system, it's picked up
  automatically, and the design page says which shell it uses.
- **A design that needs a new kind of page** (a wizard, a print view) can draft a
  layout in its own `views/layouts/`. The host looks there first, then in the shell.
  Its `NOTES.md` says it should move to the shell once agreed, the same rule as a
  component the system lacks.
- **The shell's data is part of the state:**
  - by default the layout gets its sample data from `layouts/<name>.json`;
  - a design's state can override any of it under a `layout` key, such as an
    administrator's nav, 99+ notifications, or a long company name;
  - the layout sees it as `it.layout`, and the page's model as `it`.
- **For a repo whose app already has a layout,** the shell's first session harvests it,
  as the system's harvests CSS. For an Eta or Koda app, the shell's layouts name the
  real layout files (`@app/views/layout`) instead of copying them. The host reads them
  from the repo, read-only, and every design is inside the real shell from day one,
  with nothing to drift.
- **A folder with no shell** gets a minimal built-in layout: the system's styles, Koda,
  and a main region. Designs still render, just without the app's chrome.

**How the host composes a cold load:** the route's view renders with the state's model.
The layout renders around it with `it.layout`, and `ko-location` is set to the request
path. A fragment request skips the layout entirely, as the real server would.

As built (6a):
- **Views render sandboxed.** Eta templates are JavaScript, and a design's views are
  written by the agent. Rendering them in Prelude's process would undo the fences on
  what the agent may read and write. They render in a separate Node process under
  Node's permission model (`--permission`, or `--experimental-permission` before
  23.5). That process may read the folder and Prelude's own files; it may not write,
  start processes, or load native code, and a render that runs over 5 s is killed.
  **Known gap:** Node's permission model doesn't yet cover the network.
- **The host composes pages itself,** as Prelude's own server does: the view renders,
  and the layout gets it as `it.body`, with `it.title`, `it.location` and
  `it.layout`. No Eta `layout()` call is needed in views.
- **A route's model is whatever its `data` path finds,** an object or a list, passed
  as `it`.
- **Designs choose their format by what they have:**
  - a design with `routes.json`, the shell, and any new design are views;
  - an existing design of plain screens stays plain;
  - the design system's gallery stays plain HTML.
- **Designs of views may also read Koda's package** (its skills and reference),
  added as a read-only folder.
- **A check after every turn.** The agent can't see the preview, so after each turn on
  a design of views, Prelude renders every route in every state, filling each
  `:param` with the first matching record's id. Failures appear as a note in the chat
  and are prepended to the agent's next message.
- **Verified with the real agent:**
  - A shell drafted from Spark's real `Host.cshtml`, with Spark's header, navigation,
    and alerts and inbox fragments at Spark's own URLs. Its drawer loaded a
    fragment over HTTP with Koda live.
  - A Packages design: a list, a detail page whose collateral loads as its own
    region, a row fragment, and typical, empty and long-names states. It rendered
    in the shell and switched state across the whole design.
  - The agent's first list used an include path relative to the wrong folder.
    Eta resolves includes from the including view's folder, so the agent's
    instructions now say so.

Decided 2026-10-15:
- Layouts are the app's, in a shell design (`"kind": "shell"`, one per folder), not in
  the design system. That keeps the system shareable at the organisation level later.
- For an Eta or Koda app with a layout, the shell points at the real layout files.
- Shell data: sample data beside each layout, overridable per state under `layout`.

#### Overlays in context (6a.2)

A drawer, a modal or a side panel isn't a page. It's a fragment presented in a region
the layout offers (`ko-target="drawer?"`), over the page the person was on. Shown
alone, as KodaDesign did, it can't be judged: its width against the page, what stays
visible beside it, whether the page behind still makes sense. OrchestratR does it
well, with a context layout that draws the panel over a frame of the page beneath.

**The proposal: a deep link to an overlay is the page beneath with the overlay open,
which is also how the real server should answer it.** Koda's guidance for a panel in a
browser is to compose it into the host's URL, so that reloading a drawer's URL shows
the order with its drawer open, not a bare fragment and not the order alone. So the
design states it, and Prelude's host does what the real server would:

```json
{
  "/orders/:id":      { "view": "orders/detail",    "title": "Order", "data": "orders/:id" },
  "/orders/:id/edit": { "view": "orders/_edit",     "title": "Edit order", "data": "orders/:id",
                        "over": "/orders/:id", "in": "drawer" }
}
```

- **`over`** is the page beneath, written with the overlay's own `:params`.
  **`in`** is the region it's presented in: `drawer`, `modal`, or any region a layout
  offers.
- **A fragment request** (Koda opening the drawer from a link with
  `ko-target="drawer?"`) gets the overlay's view alone, as now.
- **A cold load,** meaning the preview's frame, a reload or a shared link, gets the
  page beneath, rendered as usual, with the overlay already in its region. The layout
  receives `it.regions.drawer = { html, location }` and prints it inside the region it
  offers, with `ko-location` set so Koda knows what the region holds. Closing the
  drawer, or following any link, then behaves as it will in the app.
- **The shell's layouts print each region they offer** from `it.regions`. That's one
  line in each region, and the shell's prompt says so. The built-in layout offers a
  drawer and a modal.
- **The preview's page picker gets overlays too,** listed under their page ("Order ›
  Edit order"). Routes with `:params` become pickable everywhere, filled with the first
  matching record's ids in the current state, the same sample ids the after-turn
  check uses. So "Edit order" shows order P-10482 with its drawer open.
- **The check renders each overlay both ways,** alone and over its page.

**Why this beats a context frame:** the page beneath is the real page, rendered from
the same state, in the same document as the overlay. So the drawer's width, the page's
scroll, focus, and Koda's own behaviour (Back closing the drawer, a link inside it
landing in the right region) are all real, not a picture of a page behind a panel.

**Not in this step:** overlays opened by script rather than by a route, and nested
overlays (a modal over a drawer). The `in` field can say `modal` over a route that is
itself `over` a page, if that's ever needed.

Decided 2026-10-15:
- `over` and `in` on the overlay's route; a cold load shows the page beneath with the
  overlay open.
- Layouts print each region they offer from `it.regions`, rather than Prelude splicing
  the overlay into the HTML. That's what the app's own layout must do to answer a
  deep link to a drawer, so the design's layout stays the real one.
- Routes with `:params` are pickable everywhere, filled with sample ids from the
  current state.

As built (6a.2):
- **Rendering:** `renderPath` renders a cold load of an overlay as its `over` page,
  through that page's own route, data and layout. The overlay goes in as
  `it.regions[in] = { html, location }`, and the layout's main region gets the page's
  location.
- **The renderer** renders regions in the same sandboxed job as the page and layout.
- **The built-in layout** offers a drawer and a modal.
- **The picker** uses `pickable()`: every titled route, filled with sample ids, with
  overlays after their page. The check renders each overlay alone and over its page.
- **Verified with the real agent:**
  - The shell's layouts were updated to print their regions.
  - Packages gained an Edit Package drawer over the detail page.
  - A direct visit to `/…/packages/10482/edit` showed the package page with the drawer
    open and pre-filled from the same state.
  - The Edit button (a link with `ko-target="drawer?"`) opened the same view in the
    drawer through Koda, staying on the page.

#### Forms and changes (6b)

A design that can't save isn't a prototype. 6b lets forms post, changes the state's
fake data, and answers the way the app will: in place, out of band, closing the
drawer, or refusing with the fields marked. As everywhere in step 6, the aim is that
the design's routes and views *are* the app's: the controller the app needs is the
one the design describes.

**What KodaDesign did:**
- **Right:**
  - real POST routes;
  - answers in all of Koda's shapes: a 303 to a page, a fragment, `ko-into` refreshes,
    the empty envelope that closes the panel that asked, refusals as 422;
  - a contract test exported from it.
- **Heavy:**
  - an `exchanges.json` beside the routes, with its own effects language (sum, count,
    set to today, …);
  - per-viewer sessions behind a cookie;
  - data kept per screen;
  - a slice for each fragment.

**The proposal: POST routes in the same `routes.json`, three verbs, and an answer.**

```json
{
  "POST /spark/servicing/packages/:id": {
    "update": "packages/:id",
    "require": ["borrower", "program"],
    "form": "packages/_edit",
    "answer": { "view": "packages/_row", "data": "packages/:id",
                "also": [ { "into": "drawer?" },
                          { "into": "summary", "view": "packages/_summary", "data": "" } ] }
  },
  "POST /spark/servicing/packages": {
    "add": "packages", "require": ["borrower"],
    "form": "packages/_new",
    "answer": { "redirect": "/spark/servicing/packages/:new" }
  },
  "POST /spark/servicing/packages/:id/delete": {
    "remove": "packages/:id",
    "answer": { "redirect": "/spark/servicing/packages" }
  }
}
```

**What each part does:**
- **One verb, at a data path** (the same paths GET routes use):
  - **`update`** merges the posted fields into that record. A field keeps the type its
    current value has (a number stays a number, a checkbox a boolean), and a dotted name
    (`address.city`) reaches inside.
  - **`add`** appends a record to that list with the posted fields and a new `id`. The
    answer can refer to it as `:new`.
  - **`remove`** takes the record out.
- **`require`** lists the fields that may not be empty. A missing one is refused with a
  **422** that re-renders `form` with what was typed and the errors. The view sees them
  as `it.$errors.borrower` and marks the field with `ko-invalid-server`, as Koda expects.
  Nothing changes.
- **`answer`**, after the change:
  - **`redirect`** gives a 303 to a page (post-redirect-get), which Koda follows into
    the right region;
  - **`view` + `data`** gives a fragment, rendered from the changed data, which lands
    wherever the form aimed it (`ko-target="self"` for a row that saves itself);
  - **`also`** adds out-of-band updates: `{ into, view, data }` refreshes another
    region; `{ into }` alone is the empty envelope that closes it (the drawer the form
    was in). Table parts travel in `<template ko-into>`, as Koda requires;
  - **`event`** raises a named event (`ko-event`) for anything listening;
  - an answer of `{}` is `204`-like: nothing to show.
- **Every answer** carries `x-koda: 1` and `Vary`, like GET.

**Where the changes live: a working copy of the state, per design, in memory.** Posting
changes a copy of the current state's dataset, never the file. Every route reads the
copy, so after "Save" the list, the detail and the drawer all show the new value.
- **The copy is server state,** like the current screen and state: every window sees
  it.
- **Picking a state, or "Reset data"** in the design bar (shown once something has
  changed), throws the copy away and starts again from the file.
- **A change isn't announced** to the preview, so it doesn't reload the frame that made
  it and lose Koda's in-page state, such as the drawer closing as it should.
- **Restarting Prelude resets every copy.** The state files the agent writes stay the
  design's truth.

**Why verbs and not code, for now:** update, add and remove cover most forms, read as a
sentence ("saving updates the package, closes the drawer and refreshes the row"), and
port directly to a controller action:
- bind the model;
- save;
- return the row partial, plus the out-of-band partials;
- refuse with a 422 and the form.

When a form needs real logic (totals, workflows, a status that moves on), the next
step is a small handler per POST route, written in JavaScript and run in the same
sandboxed renderer process. That's deferred until a design needs it, as decided for
loaders.

**The rest:**
- **The agent is told** the POST format, to open forms from overlays when the app would,
  and to aim each form's answer as the real app should (`ko-target="self"` for a row,
  the drawer's form answering the row and closing the drawer).
- **The after-turn check** posts a sample of each POST route against a throwaway copy:
  - one valid post, which must answer as described;
  - one empty post, which must refuse with a 422 when the route has `require`.
- **Porting:** each POST route becomes a controller action. Its `require` list becomes
  validation, and its answer becomes what the action returns. In 6d, the same routes
  generate a contract test, as KodaDesign's export did, against the design and then
  against the app.

**Not in this step:**
- GET forms (search and filter, `?q=`). They need the query in the model; that's next.
- Uploads.
- Business logic beyond the three verbs.
- Undo.

Decided 2026-10-15:
- POST routes in `routes.json`: `update`, `add` or `remove` at a data path, plus
  `require`, `form` and `answer`. JavaScript handlers only when a design needs logic.
- Changes go to a design-wide working copy in memory, reset by picking a state or
  "Reset data".
- Refusals: `require`, answered with a 422 that re-renders `form`. Richer rules later.
- GET forms (search and filter) come in the step after this one.

As built (6b):
- **POST routes are read beside the GET routes** (`readPostRoutes`) and answered by
  `postPath`. Posting works on a clone of the current dataset, and the clone becomes
  the working copy only when the post is accepted.
- **Answers:**
  - an event goes on the answer's root element, or in an envelope when there's no
    view;
  - table parts travel in `<template ko-into>`;
  - an answer with nothing to show is an empty envelope addressed to a region no page
    has (`prelude-nothing?`), so Koda leaves the asking region alone.
- **Reset data** appears in the design bar once the current state's copy exists.
  Picking a state drops the copy.
- **The after-turn check posts each POST route** against a throwaway copy, filling
  required fields from the record or with "Sample".
- **Verified with the real agent,** in a new session on Packages, which picked up from
  `NOTES.md` and read Koda's reference itself:
  - it made the Edit Package drawer save with one POST route that updates the package,
    refreshes the page's heading and summary out of band, and closes the drawer;
  - in the browser, an empty borrower name was refused in place, with the field
    marked and nothing changed;
  - a valid save closed the drawer and updated the heading without leaving the page,
    and the list showed the change too.

#### Search and filter (after 6b)

GET forms work like any link: Koda routes them, and the URL carries the query.
- **Every view sees the query string** as `it.$query`, so a form shows what was asked.
- **The route filters, as the app's controller would,** so views never do:
  - `"search": { "q": ["borrower.name", "id"] }`: any of the fields contains `?q=`,
    ignoring case;
  - `"match": { "status": "status" }`: the field equals `?status=`;
  - an empty parameter filters nothing;
  - filters apply to the route's data when it's a list, or to the list at `"list"`
    inside it.
- **Search as you type** is Koda's own pattern: the results get a fragment route with
  the same filters, loaded by a region whose `calc-ko-source` follows the box.
- **The check** asks every filtering route for something nothing matches, so a view
  that can't cope with no results is caught after the turn.
- **Learned along the way:** Eta copies a partial's data into a plain object, so a
  bare list passed to `include()` stops being a list. Partials take objects, and a
  fragment route gives them the same shape (a data path to the object, with `list`).
  The agent is told so.
- **Verified with the real agent,** in a new session on Packages: it added a search box
  and a status select, using Koda's search-as-you-type pattern (one results region
  following both). Searching by name or package number, filtering by status, and a
  search with no matches all worked in the browser. The after-turn check first
  caught a Prelude bug: `it.$query` was non-enumerable, so it didn't survive
  `include()`. It's now an ordinary property.

#### Other stacks, proven in a demo repo (6c)

Step 6 set out to make a design's views the app's real views. For an Eta or Koda
app, the built-in host already does that. For any other stack, such as Spark's Razor,
the views have to be rendered by that stack's own engine, with its real components.

**What the built-in host already separates:** Prelude's side of serving a design is
almost all stack-agnostic:
- matching routes;
- finding data in the state;
- search and filters;
- POST verbs and refusals;
- the working copy;
- composing overlays over their page;
- choosing the layout;
- the after-turn check.

Only one piece knows Eta: the sandboxed renderer, given "render this view with this
model, inside this layout with this data and these regions".

**The proposal: the contract is the renderer, spoken over HTTP.** A repository whose
app isn't Eta provides a design host that does that one job with its own engine.
Prelude keeps everything else, so every stack gets routes, states, overlays, forms,
search, the preview and the check without reimplementing any of it.

```json
// prelude/prelude.json, committed with the designs
{
  "host": {
    "start": "dotnet run --project App/DesignHost --urls http://localhost:5199",
    "url": "http://localhost:5199",
    "views": ".cshtml",
    "guide": "prelude/HOST.md"
  }
}
```

**The contract a host implements** (Prelude ships a conformance test for it):
- `GET /__prelude/health`: 200 once it's ready.
- `POST /__prelude/render`, with a JSON body:
  `{ folder, design, page: { view, data }, layout?: { name or path, data }, regions?, query, errors? }`.
  Views are looked up exactly as the Eta host does:
  - the design's `views/`;
  - layouts from the design, then the shell, then `@app/…` in the repo.

  The host answers `200 text/html`, or `500` with the engine's error, which reaches the
  after-turn check and the agent like any render error.
- **Any other GET** serves the app's own static assets (its CSS, scripts and images)
  at their real paths. Prelude proxies them from the design's origin, so the design's
  pages link the app's real files.

**What Prelude does around it:**
- **Process:** starts the host with `start` in the folder the first time a design there
  is rendered, waits for health, restarts it if it dies, and stops it with Prelude.
  Its output goes to a log the design surface can show when something fails.
- **Rendering:** the host replaces the sandboxed Eta renderer for that folder. The
  design's origin, routes, data, forms and overlays stay Prelude's.
- **Teaching the agent the stack:** `guide` is a file in the repo, read by the agent at
  the start of every session on a design of views, covering how to write views in this
  stack. For Spark that's Razor with the real tag helpers, `design-name` for bound
  fields, the porting rules, and the components. The repo teaches the agent its own
  conventions; Prelude names no stack.
- **The format:** routes, states and POST routes are unchanged. Views use the stack's
  extension (`views/packages/list.cshtml`).

**Trust: a stack's views run as code, unsandboxed.**
- Razor views are C#, and a design host runs them with the developer's own privileges.
- The Eta host renders agent-written views inside Node's permission model; an external
  host can't be fenced the same way from Prelude's side.
- So a host runs only after the person approves it, once per folder, in Prelude's own
  dialog: "This repository's design host runs agent-written views as code on this
  machine". The approval is machine-local, in `~/.prelude/`, and is asked again if
  `prelude.json` changes.
- Sandboxing a host (a container, a restricted account) is deferred, and the risk is
  stated where it applies.

**Spark (6c.3):** DesignHost (`App/DesignHost`) already has most of what the contract
needs:
- runtime Razor compilation over the repo;
- the real tag helpers, with `design-name` standing in for `asp-for` and rendering
  byte-for-byte what production emits;
- stubs for services, authorization and the current user;
- Spark's CSS and scripts.

It gains:
- **A `/__prelude/render` endpoint:**
  - compiles views from the folder's `prelude/` directory (and the shell's layouts,
    and `@app/` paths);
  - gives the view an untyped model, as decided: the JSON as a dynamic object, so
    views read `Model.packages` and loop over it;
  - flattens the same JSON into DesignHost's sandbox state, so `design-name="Borrower.Name"`
    finds its value;
  - turns `errors` into `ModelState` errors, so the real `<field-validation>` shows them.
- **`/__prelude/health`,** and serving App/Web's static files at their real paths.
- **In Spark:** a `prelude/prelude.json`, and a `prelude/HOST.md` written from
  DesignHost's own guidance (the porting checklist, `ui-patterns`, the faking ladder for
  view components).

It's a change to the Spark repository, shared with OrchestratR's design sessions. The
existing `features/…/design/` folders keep working, because the new endpoint is beside
them. It ships as a Spark PR.

**Sub-steps:**
1. **6c.1:** The contract in Prelude, as described above.
2. **6c.2:** A conformance test (`npm run host-check <url>`), proven against a small
   reference host: the Eta renderer served over HTTP, which a new stack can start from.
3. **6c.3:** A Razor demo repository whose small ASP.NET design host implements the
   contract, plus its `prelude.json` and `HOST.md`. Verified by a real agent designing
   a screen in Razor, with states, an overlay and a form, rendered by that host through
   Prelude. (Spark is not touched.)

**Not in this step:**
- sandboxing an external host;
- hosts on another machine;
- typed models (port time, 6d);
- converting existing OrchestratR designs.

Decided 2026-10-15:
- Hosts only render; Prelude keeps routes, data, forms, overlays and the rest.
- A host runs only after the person approves it, per folder; sandboxing deferred.
- **Spark isn't touched.** The contract is proven in a demo repository instead: a small
  ASP.NET Razor app (the .NET 10 SDK is installed here), the nearest stand-in for
  Spark. 6c.3 becomes "a Razor demo host"; Spark's DesignHost can adopt the contract
  later, if wanted.

**Why `design-name`** (asked 2026-10-15):
- In Razor, a form field is normally `<input asp-for="Borrower.Name">`. `asp-for` isn't a
  string: it's a C# expression the compiler checks against the view's typed model
  (`@model PackageViewModel`). From that type the tag helper writes the field's
  `name`, `id`, `value`, validation attributes, label text and error state.
- With an untyped model while designing (the JSON, as decided), there's no type for
  that expression, so `asp-for` can't compile.
- DesignHost's `design-name="Borrower.Name"` is a plain string path. Its tag helpers
  subclass the real ones, resolve the path against stand-in metadata, and call the
  production code, so the markup is identical. At port time, when the real model type
  exists, `design-name` becomes `asp-for` mechanically.
- The alternatives:
  - typed models while designing, with classes generated from `states.json` and a
    recompile in the loop whenever the data's shape changes;
  - plain `<input name value>`, which is simple but loses the tag helpers' fidelity to
    production.

- The Razor demo uses a small `design-name` equivalent, as DesignHost does, so fields
  render exactly as `asp-for` would (decided 2026-10-15).

**As built (6c):**
- **The contract** is `server/hosts.js`, documented at its top. The render job is the
  Eta renderer's own job made repository-relative:
  `{ root, page: { views, template, data }, layout: { views, template, data } | { default: true, data } | null, regions, query }`.
  This replaces the `{ folder, design, page: { view } … }` sketch above, so a host
  needn't know how Prelude finds views. A refused form's messages travel in the data as
  `$errors`, as they do for Eta.
- **Process.** `readHostConfig` accepts hosts on this machine only (`localhost`,
  `127.0.0.1`, `[::1]`). A host starts on first render, in the folder, with
  `PRELUDE_HOST=1`. Prelude waits up to 180s for health (a first `dotnet run` builds),
  keeps the last 20 KB of its output for the design bar, and kills the whole process
  tree when Prelude stops. A localhost host is tried on IPv4, then IPv6: Node asks for
  only one.
- **Approval** is per folder, tied to a fingerprint of the host settings, and stored in
  `~/.prelude/approvals.json`. Until it's given, the design bar explains the risk and
  offers "Approve and start it", and nothing starts.
- **The agent** is told its views end in the host's extension and to read `guide`
  before writing any. The after-turn check runs through the host unchanged.
- **`tools/reference-host.js`** is the contract in a page of Node, rendering Eta. It's
  the starting point for a new stack, and it's what `test/hosts.test.js` starts.
  `npm run host-check <folder>` approves the host in a temporary home, checks health
  and that a missing view errors, then runs every hosted design's check.
- **The Razor demo** (a `dotnet new mvc` app, .NET 10, kept outside this repo):
  - `App/Prelude/DesignHost.cs` renders with runtime Razor compilation and a virtual
    `_ViewImports`. The model is a `DynamicObject` over the JSON; a missing member is
    null.
  - `$errors` becomes `ModelState`. Helpers: `Html.Body()`, `Html.Region()`,
    `Html.Query()`.
  - `App/Prelude/DesignTagHelpers.cs` subclasses `InputTagHelper`, `TextAreaTagHelper`,
    `SelectTagHelper`, `ValidationMessageTagHelper` and `LabelTagHelper`, building the
    `ModelExpression` from a path. Fields, the selected option, the error class and the
    message are the production tag helpers' own markup.
  - `prelude/HOST.md` teaches the agent Razor, `design-name` and the layout's regions.
- **Verified** (2026-10-15) with a real agent session in the demo, asked for a borrowers
  list with typical and empty states, an edit drawer and a required-field form:
  - The agent read `HOST.md` first, then wrote `.cshtml` views using `design-name`,
    `design-for` and `design-validation-for`.
  - It wrote an overlay route (`over`, `in: drawer`) and a POST answering with the row
    plus a drawer-closing envelope.
  - The after-turn check passed through the host.
  - The drawer renders the production tag helpers' fields with the status pre-selected.
    A refused save answers 422, with `input-validation-error` and the message on both
    required fields.

#### Drift: porting, and states as fixtures (6d)

Step 6 decided the end state: after porting there's one view, and the design's states
are its test fixtures, rendered in CI. Most of the machinery exists. The check already
renders every route in every state, and layouts can already be real files in the repo
(`@app/`). 6d adds what's missing.

**Porting points a route at the app's view.** A route's `view` may be `@app/<path>`, a
file in the repository read in place, as layouts already are:

```json
"/borrowers": { "view": "@app/App/Views/Borrowers/Index", "data": "" }
```

- Porting a route means moving its view (and partials) into the app, changing `view`,
  and deleting the design's copy. The routes, states and notes stay in
  `prelude/<design>/`: they describe the screen and its cases, and they're now the
  fixtures.
- It's per route, so a design can be half ported. The design bar marks which routes
  are ported.
- The developer (or their own tools) does the move, not Prelude's agent. The agent
  still edits only `prelude/<design>/**`, so a ported view is the app's: Prelude shows
  it, and changes to it go through the developer, or through Build later.

**Model drift: a typed view must accept its states.** At port time a Razor view gets
`@model BorrowerListViewModel`, and `design-name` becomes `asp-for`. The contract gains
one rule: when a view is typed, the host deserializes the data into that type strictly,
so an unknown or missing member is an error, answered as a 500 naming the member, like
any render error. Prelude doesn't change: the check reports it. An untyped view keeps
the dynamic model.

**The check, runnable in CI.** `host-check` becomes `prelude check <folder>` (for now
`node tools/check.js <folder>`, from a Prelude checkout):
- it renders every route in every state, each overlay, each filter, and each POST
  route's valid and refused posts, through the built-in host or the repo's own;
- it compares snapshots (below);
- it exits non-zero on any failure.

The demo repos get an example CI workflow.

**Snapshots: catching a page that changes.** Rendering without errors doesn't catch a
view that renders the wrong thing.
- Each (route, state) renders to `prelude/<design>/snapshots/<route>.<state>.html`,
  committed.
- They're compared as normalised HTML, with whitespace and attribute order ignored. No
  pixels and no headless browser, so it runs in any CI.
- "Approve these screens" in the design bar writes them. After that, the check fails
  with a diff when a render differs, and approving again accepts the change.

**POST routes after porting.** The design half stays checked: the refused form renders
through the real view, with the real validation markup. The controller half isn't.
Testing a real action needs the app's data layer seeded from a state, which is per-app
work. For each POST route, `NOTES.md` records what the action must do (`require` and
`answer`) as the porting spec.

**Also:** a passing after-turn check adds a one-line entry to the chat. Today a pass is
silent, and the agent says it hasn't rendered anything.

**Proven in both demo repos:** the Razor demo ports `/borrowers` and its drawer, with
typed models and a real controller; the Eta demo ports `servicing/packages`. Spark
isn't touched.

**Sub-steps:**
1. **6d.1:** `@app/` route views, the ported marker, and the check-passed entry.
2. **6d.2:** `prelude check`, with exit codes and an example CI workflow.
3. **6d.3:** Strict typed models in the Razor demo host.
4. **6d.4:** Snapshots and approval.

**Not in this step:**
- Prelude's agent porting or writing app code (Build);
- contract tests against real controller actions (Build);
- visual diffs;
- publishing Prelude as an npm package.

Decided 2026-10-15:
- A route is ported by pointing it at an `@app/` view, and the move is done outside
  Prelude, until Prelude handles building.
- Snapshots are in 6d, compared as HTML.
- POST routes get a porting spec in `NOTES.md`; controller contract tests wait for
  Build.
- Publishing Prelude can wait; the check runs from a Prelude checkout.

**As built (6d):**
- **Ported routes.** `viewOf` in host.js resolves a route's view, its form, and its
  answer's views, either in the design or at `@app/<path>` in the repository.
  - A path outside the repository, or a file that isn't there, is a render error
    naming the view.
  - `readRoutes` marks each route `ported`. The picker shows "the app’s own view",
    and the bar shows "N of M routes ported", or "ported" when they all are.
- **Posted names.** A ported form posts what the model binder reads (`Name`,
  `Borrower.Name`). Prelude merges each field into the state's own spelling of it,
  ignoring case, and `require` matches the same way.
- **The after-turn check** always adds an entry. A pass says "Prelude rendered every
  page and form in every state (N)". Pages that differ from their approved snapshots
  are listed to the person and never told to the agent, because the agent was
  probably asked to change them.
- **Snapshots** (`server/snapshots.js`) live in `snapshots/<state>/<page>.html`.
  - What's kept: each page or fragment as it's shown (an overlay over its page), and
    each refused form (`POST_…`). They're stored normalised: one tag or text run
    per line, attributes sorted, whitespace collapsed.
  - The diff is a line diff (longest common subsequence) with separate hunks.
  - A page that failed to render is reported as a failure, not as a difference.
  - Approval (the design bar, or `--approve`) is refused while any page fails, so
    approved versions are never thrown away.
  - The agent may not write `snapshots/`, as with `sessions/`.
- **`npm run check <folder> [-- --approve]`** (`tools/check.js`) replaces `host-check`.
  - It runs the built-in renderer, or the repository's host after checking its
    contract.
  - When the host doesn't start, it stops instead of trying every page.
  - It prints each failure and diff, and exits 1 if anything fails.
  - Each demo repo has an example GitHub workflow, `.github/workflows/prelude.yml`.
- **The Razor demo's host** renders an app view as its controller would:
  - It doesn't run `_ViewStart`, so Prelude still picks the layout.
  - The route's `controller` comes from `Views/<Name>/`, so `<partial name="_Row">`
    resolves.
  - A typed view's state is read with `System.Text.Json`, strictly: unmapped
    members, required constructor parameters, and nullable annotations. The error
    names the member and the model.
- **Proven:**
  - **Razor demo.** Its screens were approved first, then `/borrowers`, its drawer
    and its form were ported to `App/Views/Borrowers/` with `Borrower` and
    `BorrowerList` records and a real `BorrowersController`.
    - The check showed exactly what porting changed: the stylesheet link, the
      `Name`/`name` casing, and the `data-val` attributes the typed model adds.
    - After re-approving, three deliberate breakages were each caught by name: a
      state field the model lacks (`phone`), a missing one (`business`), and a
      changed row view (a diff showing `<strong>`).
    - The running app answers the same 422 refusal and the same save.
  - **Eta demo.** `servicing/packages` moved to `app/views/packages/`, and all 20
    pages matched the screens approved before the move.
  - **A real agent turn** on the ported Razor design ("add a state with long names"):
    - the agent read `App/Models/Borrowers.cs` to keep the state valid;
    - it changed nothing outside the design;
    - the check passed, and the new state's pages showed as not yet approved.

### Step 7: Build, within a team's lifecycle

Step 6 made a design the app's real views, and 6d made porting a route a one-line change.
Step 7 adds a session kind that does the porting, and fits Prelude into how a team
plans, builds, tests and ships, without owning any of it.

**What OrchestratR and KodaDesign taught** (studied 2026-10-15):
- **One durable spec, small.** OrchestratR's `behavior.md` used numbered, one-sentence
  rules about what a person observes, append-only, with a `*proposed*` marker until the
  code makes the rule true. The backlog was every rule still marked proposed.
- **Generate what can be derived.** Hand-written inventories and per-story specs and
  plans went stale ("stale the moment it's executed"), and status kept on a document
  rather than on items drifted.
- **The tracker owns scheduling.** KodaDesign's agent-generated breakdowns ran far ahead
  of building (63 stories accepted, 12 done), and its tracker push was never used for
  real.
- **Agents propose; people decide.** Ids must not collide across branches, and nothing
  should block a merge on missing annotations.

**What Prelude already has, so needn't write down:** the views (what it looks like),
`routes.json` (what each URL shows, and what each form changes, requires and answers),
the states (the cases, including what a role without a permission sees), the snapshots
(what was approved), and `NOTES.md` (why). Since 6d, a route is built when its view is
`@app/`, so "what's left to build" follows from `routes.json`.

**The split: the repo owns *what*; the tracker owns *when* and *who*.** Prelude stores
no stories, sprints, releases or links to them.

| Stage | In Prelude | In the team's tools |
|---|---|---|
| Design | design sessions: views, states, rules (proposed) | |
| Refinement | the Build view: what's left, grouped | |
| Stories | "Copy as story" for a group | pasted into ADO or Jira; sized, scheduled, assigned there |
| Build | a build session per story, on its own branch | the PR |
| Review | the PR shows routes ported, rules made true, snapshot diffs | review; CI runs `npm run check` |
| QA | the route × state matrix as the test plan, approved screens as expected results | defects |
| Release | nothing new: git versions the design | releases |
| After | the design stays as the app's fixtures; CI catches drift | |

QA triages each difference between the design and the app as exactly one of: the code
is wrong (a defect), the design changed on purpose (approve again), or the design is
stale (fix the design).

**Rules: `prelude/<design>/RULES.md`.** Behaviour worth saying as a rule:

```markdown
# Rules: Borrowers

- **R-k3f.** Only an underwriter sees Edit on a funded loan's borrower.
  *shown-on: /borrowers/:id/edit @ underwriter*
- **R-q8m.** Changing a borrower's email sends them a confirmation.
  *proposed*
- ~~**R-2wd.** A borrower's status can't be changed once a loan is funded.~~
  *retired: replaced by R-k3f*
```

- One plain present-tense sentence per rule, about what a person observes, with no code
  names. Ids are `R-` plus three random characters, so branches merge cleanly.
- A state can *show* a rule: the underwriter state shows what an underwriter sees. The
  rule says it's intended and general, not an accident of the data. `shown-on: <route> @
  <state>` points at where to see it; a rule may have none (an email sent).
- `*proposed*` means not built yet. The commit that makes a rule true removes the
  marker. A retired rule is struck through and keeps its id.
- The design agent writes rules as it designs, always as proposed. Only a person decides
  a rule is right (in review); there's no workflow for it.
- The check warns about a `shown-on` naming a route or state that doesn't exist. It never
  fails because a rule is missing.

**The Build view.** Per design, what's left to build, derived each time:
- unported routes, grouped by page: each page with its overlays, fragments and the forms
  they post;
- proposed rules, under the group whose routes they cite (or "Design-wide").

**"Copy as story"** gives a group as Markdown, for the tracker: what it delivers (the
pages and forms), acceptance criteria (each form's `require` and `answer`, and each
rule), and its states as test cases, with paths into the repo. Nothing is stored.

**Build sessions.** A session kind on a design, started from a group (or the whole
design):
- **A branch of its own:** Prelude creates a git worktree and branch
  (`build/<design>-<group>`). The session, its transcript included, lives on that branch,
  so it merges with the PR.
- **What it may write:** everything in the repository, except the design's views,
  states, rules, snapshots and sessions. In `prelude/` it may only point routes at
  `@app/` and remove `*proposed*` markers. If the design is wrong, it says so in
  `NOTES.md` or proposes a rule; it doesn't change the design.
- **What it does:** ports the group's views into the app, writes the controllers from the
  porting spec and the rules, points the routes at `@app/`, deletes the design's copies,
  and removes the markers of rules it makes true.
- **How it knows it works:** after each turn, Prelude runs the check through the repo's
  host, which builds the app, and tells the agent what fails, as for a design session.
- **Done:** every route in the group is ported, the check passes, and the snapshot diffs
  are the expected porting differences, which the person approves. The person opens the
  PR.

**Sub-steps:**
1. **7.1:** `RULES.md`: the format, the design agent's instructions, and the check's
   warnings.
2. **7.2:** The Build view and "Copy as story".
3. **7.3:** Build sessions: the worktree and branch, the permissions, the prompt, and the
   check after each turn.
4. **7.4:** Proven in the Razor demo: a new piece designed with rules, copied as a story,
   and built by a build session to a branch whose check passes.

**Not in this step:** tracker integration, stored stories, sprints or releases;
harvesting rules from existing code; executable walks (below).

Decided 2026-10-15:
- A rules file per design, to see what it looks like in use.
- Stories start as copied text only; nothing is stored or synced.
- A build session may write everything outside the design's own files.
- Executable tests that run against both the design and the real app: wanted in
  principle, undecided for this step.
- Unit tests in build sessions (a `test` command in `prelude.json`, run by Prelude after
  a build turn, approved like the host): undecided, so left out. The build agent has no
  shell; Prelude's check, which builds the app through its host, is its feedback.

**As built (7):**
- **`server/rules.js`** parses `RULES.md` into ids, text, the proposed and retired markers,
  and `shown-on` places (`route @ state`). `ruleWarnings` reports duplicate ids, and places
  naming a route or state the design doesn't have.
  - The check reports these warnings, and they're told to the design agent. They never
    fail anything.
  - The design agent's instructions (`rulesSection` in agent.js) apply to designs, not
    to the system or the shell.
- **`server/backlog.js`** groups a design's work by page:
  - an overlay goes with the page it's `over`;
  - fragments and POST routes go with the page whose URL is the longest prefix of theirs;
  - rules go with the group whose routes they're shown on, or are design-wide.

  A group is built when its routes are `@app/`, every view its POST routes name is
  `@app/`, and none of its rules is proposed. `storyMarkdown` writes the story:
  - **Delivers:** each route with its view as a repository path;
  - **Acceptance criteria:** each form's refusal and answer, each rule, the approved
    screens, and `npm run check`;
  - **Test cases:** one per state.
- **The Build view** (`…/d/<design>/build`, linked from the design's header) lists the
  groups and the design-wide rules. Each group has "Copy as story" (a read-only textarea
  and a Copy button) and, in a git repository, "Start a build session". It also lists the
  design's build sessions.
- **`server/builds.js`** creates a build. It refuses unless the folder is the top of a git
  repository and `prelude/<design>/` has no uncommitted changes, then runs
  `git worktree add -b build/<design>-<group>` from HEAD into
  `~/.prelude/worktrees/<folder>/`. Builds are recorded in `~/.prelude/builds.json`.
  - **A build is a folder.** `app.folders.get` finds it by id, so the worktree has its own
    design origin, host and check, and the session, transcript included, lives on the
    branch.
  - **Its host** inherits the parent folder's approval. Starting a host stops any other
    host on the same address. In a build, Prelude restarts the host before each check,
    so the check builds the turn's C#, not just its views.
- **A build session** runs in the worktree with `mode: 'build'`:
  - **Permissions:** `Edit(**)` and `Write(**)`, except the design's views, states,
    snapshots and sessions, and `.git/`.
  - **Instructions:** `buildPrompt` lists the group's routes, forms and proposed rules,
    plus the design-wide proposed rules.
  - **After each turn,** Prelude runs the check. It then deletes the design's `views/` if
    no route names one any more, and commits everything to the branch, with a "Committed
    to … (sha)" note in the chat.
  - **What the agent is told:** besides failures, the members the app's models still
    lack, and how each page differs from its approved screen (labelled as information,
    since expected porting differences are the person's to approve).
- **A design ahead of the app.**
  - **The problem:** a ported view's model read every state strictly. Designing the next
    feature, which needs new data, then broke every ported page.
  - **Now:** a host leaves out members a typed model doesn't have and says so in an
    `x-prelude-ahead` response header. Prelude shows them as "the design is ahead of the
    app", which never fails. A missing member or a wrong type still fails.
  - **Merging:** design merges continuously, so a state can legitimately be ahead of the
    code.
- **Smaller fixes found on the way:**
  - The check's sample post for an "add" form copies a sibling from the list, or from
    another state when the list is empty.
  - A new item in an empty list gets id 1.
  - Snapshots compare regardless of CRLF checkouts (`core.autocrlf`).
- **Proven in the Razor demo** (now a git repository):
  1. **Design.** A design session asked for a borrower detail page with notes that only
     underwriters can add.
     - It stopped and asked first: new data would break the ported models. That led to
       the "ahead" change above.
     - It then designed the page and three proposed rules, and recorded in `NOTES.md`
       what it couldn't change (the app's row view).
  2. **Approve and commit.** The new screens were approved and the design committed.
  3. **Build view.** It showed the Borrowers page as built and the new Borrower page as
     to build.
  4. **Build session.** It started on `build/borrowers-borrowers-id`. The agent, in one
     turn:
     - extended the models;
     - wrote the controller, with a 403 for non-underwriters and a 422 for an empty note;
     - ported the views with `asp-for` and moved the styles into the app;
     - pointed the routes at `@app/` and made all three rules true.

     Prelude deleted the design's views and committed. A second turn only corrected
     `NOTES.md`.
  5. **Result.** The check passed with 25 pages and forms. The only differences from the
     approved screens were the stylesheet link, and approving them committed exactly
     those four lines.
  6. **Real app.** It serves `/borrowers/1041` in both shapes and refuses a note from a
     non-underwriter with 403.
- **Found, not yet fixed:**
  - **One data path per route** made the agent read the signed-in user through a second
    route. A page that needs its record *and* who's signed in is common.
  - **Grouping by URL prefix** puts `/borrowers/:id/row` and `POST /borrowers/:id`, which
    belong to the list, with the detail page. They're built, so it's noise.
  - **This machine refuses to launch a freshly built `App.exe`** from a temp folder, so
    the demo runs through `dotnet App.dll` (`UseAppHost=false`).

### Step 8: The app - how a first build creates it

Step 7 assumed a repository with an app in it, whose conventions a build follows. A
folder that's only `prelude/` (Apiary, when it was first tested) has nothing to build into:
a build agent would have to choose a stack and set up a project by itself. Step 8 decides
how the app comes to exist.

**The design's views already imply the stack.** Without a design host, a folder's views are
Eta rendered with Koda, and after porting they are the app's views, element for element.
So the default app is **Node, Express, Eta and Koda**. Any other stack needs a design host
(step 6c), so its views are written in that stack's language from the start. That is a
choice to make before designing, not at build time.

**Choosing the stack: once, at the first moment it matters.**
- **When Prelude asks:** a folder with no app and no design host asks the first time
  someone creates a design there, or starts a build.
- **The default:** "The app will be Node, Express, Eta and Koda", with Continue.
- **Customising:** a muted "Choose another stack" link opens a field to describe it, such
  as "ASP.NET Core MVC with Razor".
- **Where the choice goes:** `prelude/prelude.json`, as `"app": { "stack": … }`,
  committed, so the whole team sees it.
- **The default** writes the choice and carries straight on to the design: nothing waits
  on the app.
- **A customised stack** must have its app built first, since the app build also writes
  the design host, its `prelude.json` entry and its `HOST.md`. Until then, designing waits.

**The app build: a group of its own, first.** When `prelude.json` names a stack but no app
yet, the Build view shows one extra group before the features, "The app". Feature groups
say "Build the app first", because their branches would start from a repository with
nothing to build into. It's a build session like any other: its own branch, the check after
each turn, a commit per turn, and the person opens the PR. Its job is the foundation:
- **The server:** each URL answers in Koda's two shapes, with the headers, `Vary`
  and 422 conventions from the `koda-server-setup` skill. Plus Eta views, Koda, static
  files, `npm start` and a README.
- **The shell, ported:** its layouts move into the app's views, and the shell's layouts
  name them (`@app/…`), so every design renders inside the real layout.
- **The design system, served:** the app serves `prelude/<system>/system/` as its
  stylesheets. One source, no copy to drift.
- **Data, from the states:** each area's data comes through one module. It starts as an
  in-memory store seeded from the typical state, so the app runs as soon as it's built.
  Real sources (Apiary's Spark API) are ordinary feature stories behind that seam.
- **For a customised stack:** the same in that stack, plus its design host (the contract in
  `server/hosts.js`, `tools/reference-host.js` as the example) and `HOST.md`.
- **The record:** the build sets `prelude.json`'s `app` to where the app lives and how to
  start it. That is how Prelude knows the app exists, and the feature groups unlock once
  it's merged.

**Kept simple:** tests, CI, auth, a database and the rest are the agent's to propose as
features are built, not part of the app build.

**Sub-steps:**
1. **8.1:** The stack choice: asked when designing or building in a folder with no app and
   no host; Continue for the default, "Choose another stack" to describe one; written to
   `prelude.json`.
2. **8.2:** The app group in the Build view, its build prompt, and feature groups held
   until the app exists.
3. **8.3:** Proven on a folder that's only `prelude/` (a copy of Apiary's designs): the
   default stack chosen, the app built on a branch, its check passing, then a feature
   built on top.

Decided 2026-10-15:
- The default app is Express, with Eta and Koda.
- The stack is asked once, quickly: the default as the obvious choice, a muted option to
  customise before proceeding.
- The app serves the design system's CSS from `prelude/`, rather than a copy.
- The first build uses fake data (the typical state); real data comes later, feature by
  feature.
- The app build stays minimal; everything else is decided with the agent while building.

### Step 9 and later: candidates, each to be fitted into the model first
- **Sharing:** publish a snapshot of `prelude/<design>/` + its design system as static
  files (an Artifact, a static host, or a tunnel to the preview route). It needs only
  read-only viewer routes, which step 2 already shapes.
- Flow map, captures/annotations.
- Hand-editing a screen in place.
- Ending a session with a summary appended to `NOTES.md`, optionally committing.
- **Walks:** executable steps on a rule (given a route in a state, click, fill, expect),
  run against the design and against the real app.

## Explicitly not now

Accounts and sign-in, a database, branches per design session, multi-user presence,
comments, the custom dialect, MCP tools, epics, tracker integration.

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
