---
name: koda-review
description: Review a repository that uses Koda against the practices the other Koda skills teach, and report what to change - scripts and event listeners where a binding, an action or the server would do, markup built in handlers, CSS that fights the host, a server that answers in one shape, and an agent setup that never loaded the skills in the first place. Use when asked to review, audit, check or grade a Koda application or host; when an application was built by an agent and should be checked before anyone builds on it; when a Koda screen works but looks like it was written as a single-page app; or before calling a Koda change finished.
---

# Reviewing a Koda repository

An application built by an agent usually works. The failures this review looks
for are the ones that work: a listener where a binding would do, a `fetch`
where a region would do, a template in the client for something the server
owns, a hex value where a token would do. Each is code that Koda exists to
delete, and each teaches the next agent that this is how the repository is
written.

This skill is the checklist and the judgement. The rules themselves are in the
four skills it checks against, and every finding names the one that says so:

| skill | covers |
|---|---|
| `koda-app-authoring` | the ladder, the stopping rule, regions, `ko-history`, embedding |
| `koda-styling` | tokens, the layer order, `@scope`, container queries, icons |
| `koda-server-setup` | two shapes, headers, view files, caching, errors, redirects |
| `koda-composition` | applications and hosts deploying apart |

Read the ones the repository touches before starting, and look attributes up in
`docs/reference.md` (in `node_modules/@kodalang/core/` when the repository
installs the package, or in the Koda repository) rather than from memory. A review that recommends an attribute that does not
exist is worse than none.

**Report; do not fix** unless asked to. The person decides which findings to
take, and a review that rewrites as it goes cannot be read as a review.

## 1. Find out what you are looking at

Before searching for anything, establish:

- **The stack and its template engine.** Razor, Eta, Jinja, ERB... and where
  the views live. Most of the findings are in views.
- **Where the Koda library is**, vendored or installed, and **exclude it**. The
  library's own source uses `addEventListener`, `fetch` and `innerHTML`
  properly; none of that is a finding.
- **The roles.** A standalone application, an application behind a host, a
  host, a design system - or several of these in one repository. The rules
  differ: a host may use `@media` for its own chrome and must put its CSS in
  the `host` layer; an application may do neither.
- **Where client code lives**: `<script>` in views, `.js` files the page loads,
  the one module that calls `start()`.

For a large repository, split the sweep below by area - views and client code,
CSS, server - and give each to a subagent with this skill's relevant section,
then judge their candidates yourself.

## 2. The agent setup

The cheapest fix is the one that stops the next mistake. Check:

- **The skills are installed**: `.claude/skills/koda-app-authoring`,
  `koda-styling`, `koda-server-setup`, and `koda-composition` if there is more
  than one application or any host, each with its `SKILL.md`. User-level copies
  in `~/.claude/skills/` count, but say that a teammate will not have them.
- **They are current.** The package ships the skills, so diff each copy
  against `node_modules/@kodalang/core/.claude/skills/` - the version the
  application actually runs - or against a Koda checkout if it vendors the
  library instead. A stale skill teaches renamed attributes with authority.
- **The application imports the package by name.** An import of
  `@kodalang/core/src/...`, or a path into `node_modules/@kodalang/core/src/`,
  reaches past the package's `exports`; the entry point is safe to import in
  Node, so there is no reason to.
- **Something tells an agent to load them.** A skill is loaded when its
  description matches the task, and "add a delete button" does not obviously
  match "write screens for a Koda application". The repository's `CLAUDE.md`
  (or `AGENTS.md`) should say so outright. If it does not, propose adding:

  ```markdown
  ## Koda

  This application is built with Koda. Before writing or changing a view, a
  stylesheet or a handler, load the matching skill - `koda-app-authoring`,
  `koda-styling`, `koda-server-setup` (and `koda-composition` for anything
  that crosses an application or a host) - and follow it. Look attributes up
  in the Koda reference rather than from memory. Run `koda-review` before
  calling a change finished.
  ```

- **The instructions do not contradict them.** A `CLAUDE.md` that says "use
  React for interactive widgets" or "put shared styles in `:root`" wins over a
  skill. Report the conflict.

## 3. Sweep for candidates

Search with the patterns below. **Every hit is a candidate, not a finding** -
section 4 is where it becomes one. Search views, client scripts, stylesheets
and server code separately, because the same word means different things in
each. The patterns are ripgrep regular expressions; `\|` in a table is only
markdown's way of writing `|`, so search for `a|b`, not `a\|b`. None of them
needs look-around, which ripgrep does not support without `--pcre2`.

**Follow the wiring before concluding something is missing.** Headers are
often set in middleware or in the file that mounts the handlers, not in the
handlers themselves; a header absent from `orders.js` may be set in `server.js`.

### Client code and views

| search for | usually means | the Koda way (`koda-app-authoring`) |
|---|---|---|
| `addEventListener\(` | a listener doing a binding's or a trigger's job | `calc-*` for a derived value, `ko-set` for "put that there", `ko-invoke` for "do this when" |
| `\son(click\|input\|change\|submit\|key\w+)=` | an inline handler | an action (`ko-set`), a command (`command="--koda-revert"`), or a real form |
| `fetch\(\|XMLHttpRequest\|axios\|\$\.(ajax\|get\|post)` | the client fetching HTML or JSON by hand | a region: `ko-scope`, `ko-target`, `ko-source`, `ko-form` |
| `setTimeout\|setInterval` | a hand-written debounce, poll or clock | `ko-debounce`, `ko-invoke="every:5000"`, `now()` and `duration()` in an expression |
| `innerHTML\|insertAdjacentHTML\|createElement\|<template\|cloneNode` | a client-side template | the server renders the row; `ko-attach="last"` puts it there |
| `JSON\.parse\|\.json\(\)` | a JSON API behind the screen | the server answers HTML |
| `history\.(push\|replace)State\|location\.(href\|assign)\|[^-\w]location\s*=` | routing by hand | `ko-scope` and `ko-history` |
| `\.hidden\s*=\|classList\.\|style\.(display\|visibility)` | showing and hiding by hand | `calc-hidden`, `calc-class-<name>`, `visible-when-selected` |
| `\.(value\|textContent\|disabled\|checked)\s*=` in `.js` and `<script>`, not in `ko-set` | a value written by script | `calc-value` / `calc-text` if derived, `ko-set` if placed |
| `querySelector\|getElementById` in a `type="koda"` script | reaching out of the script's own content | names from `koda.scope()`, parts declared with `ko-as` |
| `<script` without `type="koda"` in a partial (the layout is exempt) | a script that never runs when attached | `type="koda"`; the page's one module is the only other script |
| `import ` at the top of a `type="koda"` script | a syntax error in a classic script | dynamic `import()`, guarded on `isConnected` |
| `window\.shell\|navigator\.userAgent` in an application | deciding what to render by host | a `ko-source` region that negotiates; see below |
| `id="[^"]*(<%\|@\|\{\{\|\$\{)` | an id interpolated to be unique per row | `ko-item` on the row and plain names inside it |
| `ko-into="[^"]*"[^>]*>\s*<(tr\|td\|th\|tbody\|tfoot)` on a `div` or `table` | table parts the parser drops, so the row arrives with no cells | `<template ko-into>` around them |
| `ko-into` delivering `<li hidden>` or `<div hidden>` with no id, to stand in for something gone | a region taken away by replacing it with nothing visible | `ko-attach="remove"` on the envelope |
| an answer carrying `<div hidden ko-event…>` so a drawer is emptied into it, with `:has(> :not([hidden]))` CSS to hide it | closing the panel that asked, by trick | an empty envelope: `<div ko-into="drawer?"></div>` |
| `Buffer.concat(…).toString\|request.text()\|data += chunk` before splitting a multipart body | uploads corrupted as UTF-8 | the framework's multipart parser (`koda-server-setup`, *Files*) |
| `(commandfor\|popovertarget\|for)="[^"]*(<%\|@\|\{\{\|\$\{)` | a per-row id minted so a button or label can reach its row's dialog, menu or field | `ko-for="confirm"` and `ko-as="confirm"`: Koda finds the row's own and writes the id |
| `insertBefore\|previousElementSibling\|nextElementSibling\|data-move-(up\|down)` | move-up / move-down buttons reordering rows by hand, or moving them between lists | `command="--koda-move-up" ko-for="list"` (and `-down`, `-first`, `-last`) in the row, `--koda-move-next-list` across lists sharing a `ko-move-group`; the form posts the new order |
| `draggable="true"\|dragstart\|dragover\|mousedown\|pointerdown\|sortable` | drag and drop written by hand, or a library brought in for it | `ko-drag="list"` on the row, `ko-move-group` across lists, `[ko-dragging]` / `[ko-drop-target]` in CSS, and the move buttons beside it |
| `calc-ko-source="[^"]*\+` without `encode(` | a URL that breaks on `&` | `encode(q.value)` |
| `ko-set="[^"]*\w-\w[^"]*="` | a hyphenated name parsed as subtraction | `row['data-state'] = 'open'` |
| `embedded\|isEmbedded\|standalone`, then read whether it decides `ko-history` | the address-bar decision made at runtime | `ko-history` stated unconditionally; the host says `ko-history="none"` |
| `ko-history` on a tab, a side panel or a wizard step | a URL that reloads into something else | no `ko-history`; `ko-focus="region"` if it should take focus |

### CSS - in stylesheets and in `<style>` in views

| search for | usually means | the Koda way (`koda-styling`) |
|---|---|---|
| `#[0-9a-fA-F]{3,8}\b\|rgba?\(\|hsla?\(\|oklch\(` | a literal colour | a role token: `var(--accent)`, `var(--fg-muted)` |
| `(margin\|padding\|gap\|inset)[^:]*:\s*[^;]*\d+(px\|rem)` | a literal space | `var(--space-2)` |
| `border-radius:\s*[\d.]` | a literal radius | `var(--radius-sm)` |
| `@media[^{]*(width\|height\|orientation)` in an application | layout keyed on the window | `container-type: inline-size` on the root, `@container` |
| `prefers-color-scheme\|color-scheme` in an application | the application choosing the theme | `light-dark()` in tokens; the host sets `color-scheme` |
| `!important` | winning by force | the right layer; the only exception is `[hidden]` in `base` |
| `^\s*(html\|body\|main\|:root\|input\|button\|a)\b`, then check it is outside `@scope`, in an application | styling the page it does not own | `@scope (.app-root)` |
| `@layer` in an application's own rules | the application under the host | unlayered, inside `@scope` |
| a shared file not starting `@layer tokens, base, components, host;` | load order deciding who wins | that exact statement first, in every shared file |
| a host stylesheet with rules outside `@layer host` | a host that beats every application | all of it in `host` |
| a host selector naming an application's class | a host reaching inside | a token the design system is missing |
| `<svg` in a view | an inline icon | a file drawn with `mask`, named by a token |
| `fa-\|material-icons\|<i class=` | an icon font | the same |
| `url\(\s*['"]?[^/'"\s]` in an icon token | a URL resolved against the wrong file | root-relative |
| `mask` without `forced-color-adjust: none` | an icon that vanishes in high contrast | add it |
| `content-visibility` without `min-width: max-content` | long lines clipped | add it |
| `<style` in a partial rendered per row | fifty style elements | one stylesheet, or `@scope` in a panel that appears once |
| a longer selector or `:is()` added to beat another rule | a specificity contest | a layer |

### Server

| search for | usually means | the Koda way (`koda-server-setup`) |
|---|---|---|
| no `x-koda-fragment` anywhere in the server | one shape for every request | check it; render the partial or the layout around it |
| no `Vary` with `x-koda-fragment` | a cache serving the wrong shape | set it in middleware, and configure every cache in front |
| no `x-koda` response header | the application's 422 treated as foreign | set `x-koda: 1` on every response, errors included |
| `` [`'"]\s*<(div\|tr\|li\|section\|p\|span)`` in a handler, `$"<`, `f"<` | HTML built in code | a view file in the template engine |
| a layout region with `ko-scope` and no `ko-location` | a page that routes from nowhere | `ko-location` set to the request path |
| validation failure answered with a redirect or a 200 | a refusal Koda cannot show in place | 422, the fragment, `ko-invalid-server` on the field |
| a `POST` handler that renders the page | a reload that resubmits | `303` to the `GET` |
| a file served into a region | a binary body read as text | `<a download>` or `ko-download` |
| `ko-outbox` with no read of `x-koda-request-id` | a replay applied twice | dedupe on it; record `x-koda-queued-at` |

### Across applications and hosts (`koda-composition`)

| search for | usually means |
|---|---|
| `from\s+['"](\.\./)+` leaving the deployable's own directory | an import across deployables; make it a versioned package |
| `node_modules/` inside an import path | a relative path into a dependency; import it bare |
| an application's id, name or path in a host's code | a host that must redeploy for a new application |
| `cookie\|authorization` forwarded by a proxy, or `headers: req.headers` | the host's identity leaking into an application |
| `x-user\|x-principal` read by an application | believing the host instead of a signed token |
| the proxy deciding page or asset by path or extension | decide from the answer's `content-type` |
| `Vary` set by the host rather than appended | an application's `Vary: accept` lost |
| a service worker importing an application's module | a host that redeploys with every application |
| `href="/` in an application without `target` | a link a `/`-scoped host will pull into the panel |

## 4. Judge each candidate

Read the code around every hit. The test is the one in `koda-app-authoring`:
**is there a value here at all?**

- **A listener, timer or `fetch` inside a `type="koda"` script that draws a
  canvas, drives a third-party widget, reads geometry or makes a sound is
  correct.** Check instead that it is set up at the top level, re-runs through
  `watch()` rather than a listener on a field, and that anything attached
  outside its own content is undone in `onRemove()`.
- **A listener that computes a value to display, keeps two fields in step,
  shows or hides something, or builds a URL is a finding**, however short.
  Name the rung it should be: binding, action, or the server.
- **`window.shell?.notify(...)` is fine**; `if (window.shell) renderNative()`
  is not. Calling a native feature through the bridge is the composition
  skill's design. Deciding *what to render* by host is what negotiation is for.
- **A literal colour in the design system's `tokens` layer, or in a host's
  `host` layer setting a token, is where literals belong.** In an application
  it is a finding.
- **A literal the design system has no token for is the design system's
  finding.** Thirty literal spacings in an application whose design system
  defines no `--space-*` are one finding - add the tokens - not thirty against
  the application.
- **`@media` in a host's own chrome is allowed.** `@media print` and
  `prefers-reduced-motion` are not layout, and not findings.
- **Inline `<svg>` that is an illustration or a chart drawn from data** is not
  an icon. An icon is a glyph that means an action or a thing.
- **Building HTML in code is acceptable** in a test fixture, a response of one
  short line, or where the code says why a view was measured too slow.
- **Tests and tooling are out of scope** unless they ship to the browser.

Then look for what a search cannot find. Trace every handler that changes
something through both shapes:

- **With `x-koda-fragment: 1`**, where does the answer land? It goes to the
  asking control's target, with its `ko-attach` - and so does a refusal. A
  `409` or `422` that carries `x-koda: 1` is attached exactly as a success
  would be, so a whole record sent back to a row's `ko-attach="replace"`
  replaces one `<tr>` with an `<article>`. Every answer, success or refusal,
  has the shape of the place it lands.
- **Without it** - no script, or a form that fell back - does a `POST` answer
  `303`, or render a page that resubmits on reload?

Open the views for the busiest screens and read them against the ladder:

- A row added, removed or reordered by script when the server owns the list.
  A person reordering it is `--koda-move-up` and `--koda-move-down`; a position-number
  field standing in for them is the same gap, worked around.
- `ko-target` where `ko-scope` would let plain links land with no attributes.
- An action where the region should follow page state (search-as-you-type is
  `calc-ko-source`, not a button's `ko-invoke`).
- A row that answers with itself, `ko-target="self"`, and no
  `ko-attach="replace"` - the answer nests inside the old row.
- Two `calc-value` bindings pointing at each other, standing in for two-way.
- A client guard that checks fewer rules than the server enforces.
- An expression that parses and says the wrong thing. Read each one aloud
  against the case the screen is most often in - a new, empty row; nothing
  selected; a zero total - and check the answer is the one the server would
  give.
- A long list that is a virtual list, or chunks that chain rather than slot.
- An expression long enough to need a comment, which should be a named value
  the server renders.
- An application with global ids and no `ko-item` root, so it cannot be
  rendered twice or inside a host.

## 5. Run it, if you can

A static review misses what only a running server shows. If the application
can be started locally:

- Request one URL twice, with `x-koda-fragment: 1` and without, and confirm the
  first is a fragment and the second a whole page; check `vary` and `x-koda`
  on both (the commands are at the end of `koda-server-setup`).
- Submit a form with an invalid value and confirm a 422 carrying the fragment.
- In a browser, load a deep link cold, click into a region, press back, reload.
- Do the bare-host test from `koda-styling`: the host's stylesheet off, a
  garish `--accent` and the other `color-scheme`, and the panel in a 320px
  container.

Say which of these you ran. If you could not run the server, say so under
**Not checked** rather than implying the headers are right.

## 6. Report

Group findings by how much they cost, not by file:

- **Broken** - misbehaves now or on the first change: a `type="module"` script
  in a fragment, a server with one shape, no `x-koda` on a 422, no `Vary`
  behind a cache, a self-answering row without `ko-attach="replace"`, a
  refusal whose body does not fit its target, a `POST` that does not
  redirect, an unencoded URL, cookies crossing a proxy.
- **Against the grain** - works, and is the code Koda exists to delete:
  listeners, hand-rolled fetches and debounces, client templates, HTML in
  handlers, literal values in CSS, `@media` in an application, inline icons.
- **Setup** - skills missing or stale, nothing telling an agent to load them,
  instructions that contradict them.

```markdown
# Koda review: <repository>

<One paragraph: what the repository is, its roles, and the overall state.>
Broken: N · Against the grain: N · Setup: N

## Broken
### <Short title> - `path/to/view.eta:42`
<What the code does, in a sentence.> <Why it is wrong, in a sentence, and the
skill and section that says so.>

    <the current markup, a few lines>

Instead:

    <the Koda way, a few lines, using only attributes in the reference>

## Against the grain
...

## Setup
...

## Done well
<A few lines on what follows the practices, so a fix does not undo it.>

## Not checked
<What you could not run or reach, and why.>
```

Keep one finding per cause: forty listeners that are all "a calc-text would do"
are one finding with a list of locations and one worked rewrite. Put the
highest-leverage change first - usually the setup, because it stops the next
screen being written the same way.

Offer to make the changes, grouped the same way, and say which would change
behaviour a person can see.

## Traps

- **Reviewing the library.** A vendored `koda.js` is full of the patterns this
  review hunts. Exclude it first.
- **Grep as verdict.** Every table above lists candidates. A reviewer that
  reports every `addEventListener` will be ignored the first time one is
  correct.
- **Recommending from memory.** Check every attribute and function you suggest
  against `docs/reference.md`. The rewrite is the part the person will copy.
- **Reporting a finding without its rung.** "Remove this listener" leaves the
  person to rediscover the ladder; "this is `calc-text`" does not.
- **Fixing while reviewing.** Unless asked, report.
- **Missing the setup.** Twenty findings in the views and none about why an
  agent wrote them means the next twenty are already on their way.
