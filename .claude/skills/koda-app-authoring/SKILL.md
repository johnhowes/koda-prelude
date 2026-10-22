---
name: koda-app-authoring
description: Write screens for a Koda application the way Koda intends - declarative bindings and actions first, the server rendering anything it owns, and a script only where the work is genuinely imperative. Use when building or changing a view, panel, form, list, grid or search in a Koda app; when deciding between ko-scope, ko-target and a computed ko-source; when deciding whether a region should own a URL; when a screen will be shown inside another team's host; when a list or file is too long to render at once, or a virtual list looks tempting; or when tempted to add a script, an event listener, a debounce timer or a fetch call by hand.
---

# Writing a screen in Koda

The library is small and the discipline is most of the value. An agent's default
instinct — reach for a `<script>`, add a listener, write a fetch — produces code
that works and that Koda exists to delete. This is how to stay out of that.

Look attributes up in `docs/reference.md`. This is about *which* to reach for.

**Write every screen as if somebody else's page will host it**, because in a
Koda system it usually will. An application owns one URL space and answers
HTML there; a host owns the page around it, and the two are deployed by
different people on different days. Nothing a screen does may depend on which
host it is in, or on being deployed alongside anything. When a system has more
than one application or more than one host, read the `koda-composition` skill
before designing it; for CSS, `koda-styling`.

**Write every screen so someone who knows only HTML can follow it.** That is
much of what Koda is for: a backend developer, a designer or a reviewer should
be able to open a view and see what it does. So use plain elements and real
links and forms; give ids and `ko-as` names that say what the thing is
(`dueDate`, not `d2`); keep each expression short enough to read at a glance,
and move a long one into a named server-rendered value rather than making it
clever; and prefer the `*-when-*` shorthand where it reads as a sentence.

## The ladder

Work down it. Stop at the first rung that fits, and do not skip a rung because
the one below is more familiar.

**1. Is it a value derived from other values? → a binding.**

```html
<span calc-text="money(qty.number * price.number)"></span>
<button calc-disabled="poRequired.selected && po.empty">Submit</button>
<div visible-when-selected="needsApproval">…</div>
```

A binding says what something *is*, and keeps saying it. No listener, no
recompute call, no dependency list — reading a value subscribes to it.

**2. Is it "when this happens, put that there"? → an action.**

```html
<select ko-set="rate.value = self.option.attr('data-rate')">
<button command="--koda-revert" commandfor="editForm">Undo</button>
```

Assignment at a moment, which the person can then change. Not a binding: the
value is not *derived*, it is *placed*.

**3. Does the server own it? → let the server render it.**

This is the rung most often skipped, and the most valuable. Anything involving a
collection, a record, a template or a permission belongs to the server:

```html
<!-- Add a row: the server owns the collection, so the server renders the row -->
<button ko-form="/order-lines" ko-method="post"
        ko-target="lines" ko-attach="last">Add line</button>
```

One request, one fragment, no client-side template — and the row's markup exists
once, on the server, rather than twice and drifting.

"On the server" means **in a view file**: a partial in the project's template
engine, used both inside the list and on its own after an edit. Not a string
assembled in a handler. The screen's markup is what a person opens to
understand or change it, so it has to be somewhere they can find and edit it.
If the project has no template engine yet, ask which one they want before
picking; `koda-server-setup` has the options and the reasons.

**4. Only now: `<script type="koda">`.**

## The stopping rule

The bottom rung is for work that is genuinely imperative. The test is not "is
this hard to express declaratively" — it is **"is there a value here at all?"**

| genuinely a script | not a script |
|---|---|
| Drawing on a canvas | Computing a number to display |
| Driving a third-party widget (editor, chart, map) | Keeping two fields in step |
| Reading geometry a `ResizeObserver` reports | Reacting to a server event |
| Moving a `File` between inputs | Building a URL from a field |
| Wiring a library that demands a DOM node | Showing and hiding things |
| Making a sound (Web Audio) | A countdown, or "5 minutes ago" |
| A million-row grid edited in place | A long list or a huge file (see **Long content**) |

If you are about to write `addEventListener('input', …)` or `setTimeout` for a
debounce, or assemble a URL by hand, stop — each has an attribute. The same
goes for `setInterval` to keep a time current: render the moment as
`<time id="due" datetime="…">`, and derive the rest with
`calc-text="duration(due.time - now())"`, or
`duration(due.time - now(60000), 'relative')` for something that only needs to
move once a minute.

When a script *is* right:

```html
<section ko-item>
  <canvas ko-as="meter"></canvas>
  <script type="koda">
    const { value, rate, meter, watch, onRemove } = koda.scope();
    const paint = () => { /* … draws from value.number and rate.number … */ };

    watch(paint);                                   // re-runs when those change
    const observer = new ResizeObserver(paint);     // geometry: the graph cannot see it
    observer.observe(meter.element);
    onRemove(() => observer.disconnect());
  </script>
</section>
```

Four rules, all load-bearing:

- **`type="koda"`, never `type="module"`.** A script inserted through `innerHTML`
  never runs, so a fragment's module script silently does nothing. This marker is
  what makes an attached partial behave like the same partial rendered inline.
- **`koda.scope()` at the top level**, not inside a callback — it resolves off
  the running script.
- **`watch()` instead of listeners** for anything that depends on values. It is
  the same reactive engine as `calc-*`, and it is disposed with the content.
- **`onRemove()` for anything you attached outside your own content** — an
  observer, a global listener, a third-party instance. Everything else is cleaned
  up for you; these are not.

A `type="koda"` script is a classic script: no `import` statements. Use dynamic
`import()` if you need a module, and guard on `region.element.isConnected`
before starting anything, because the person can leave while it loads.

## Where content comes from

Three ways to fill a region. The question each answers is *who decides what is
in it*:

| | who decides | use when |
|---|---|---|
| `ko-scope="/orders"` | **the URL** | many links should land here, including ones the server renders later. Nothing has to name the region. |
| `ko-target="panel"` | **a control** | one control aims at one region whose content is not *at* that URL — a status panel, a preview. `ko-target="self"` when the region *is* the one asking, such as a row that saves. |
| `calc-ko-source="…"` | **page state** | the content is derived from what is on the page rather than caused by an action. |

The test separating the third: **if nobody activates anything, should this region
still change?** For search-as-you-type, yes — it follows the box. That is a
binding, not an action.

`ko-scope` is the idiomatic default for master-detail and is what makes a
server-rendered `<a href>` need no client attributes at all. Prefer it.

**Declare the scope; do not lean on the one a region infers.** A region with
no `ko-scope` owns what it last loaded and what is beneath it - so a detail
panel showing `/orders/42` does not own `/orders/43`, and its "next" link goes
to the shell. What it owns follows the content, redirects included, and a panel
that owns something different after every load is how content ends up in the
shell. If links
should land in a region whatever it is showing, write `ko-scope`.

**When a region answers with itself, say `ko-attach="replace"`.** The default is
to replace a region's *children*, which is right for a panel and wrong for a row
that saves itself and gets a row back:

```html
<tr class="line" ko-item ko-region ko-target="self" ko-attach="replace"
    ko-entry ko-form="/claims/4021/lines/12" ko-method="post" ko-invoke="change">
```

Without it the answer is nested *inside* the element it came from. The page
still looks about right, so this is easy to miss — but the original element and
its bindings are still wrapped around the new content, and the row quietly stops
responding to its own fields.

A row that posts to a URL underneath a bigger region's scope needs the target
too, or the answer to a row edit replaces the whole record with one `<tr>`. Say
`self` rather than an id: the row cannot name itself — a name belongs to the
item *containing* the declaration — and an id here would be one the server has
to keep unique for no other reason. `ko-target` is read off the control and is
not inherited, so a button inside that row says `ko-target="self"` itself if it
is the one asking.

```html
<!-- search-as-you-type: no listener, no debounce timer, no fetch -->
<input type="search" id="q">
<div id="results" ko-region
     calc-ko-source="'/search?q=' + encode(q.value)"
     ko-invoke="input:q" ko-debounce="250"></div>

<p calc-text="query('.result').count() + ' results'"></p>
```

Fast typing is already handled: a region takes the answer to its own latest
question, and the stale one is refused.

## Long content

A list of thousands, a 200,000-line diff, a log. The instinct is a virtual list
- keep only the rows on screen, recycle them on scroll. Don't. It takes
find-in-page, selection, printing and screen readers with it, because the text
is no longer in the page, and it puts script in charge of the scrollbar. Work
down this instead:

1. **Don't send it.** Past a size the server knows is too much, it renders the
   size and a link to load it anyway. The server knows the size; the decision
   is the server's.
2. **Send a slot for every chunk.** The first answer is one chunk and an empty
   slot for each of the rest, each as tall as its content will be:

   ```html
   <div class="chunk">… lines 1-500 …</div>
   <div class="slot" style="--lines:500"
        ko-source="/diff/lines?from=500" ko-defer
        ko-invoke="visible" ko-debounce="150"
        ko-attach="replace">Lines 501-1,000</div>
   <div class="slot" style="--lines:500" … from=1000 …></div>
   ```

   Each slot fetches its own chunk when it has been in view for 150ms and
   replaces itself with it. The scrollbar is the real length from the start,
   so End and a dragged thumb land in the right place and fetch only what they
   stop on - the debounce is what stops a drag fetching every slot it passes.
   No `ko-target`: a region with `ko-source` is scoped to that path, so its
   answer comes back to it.
3. **`content-visibility: auto` on every chunk**, so the browser skips layout
   and paint for what is off screen and keeps the text findable. It is one
   rule and most of the win; the `koda-styling` skill has the details.

Slots still hide unfetched chunks from find-in-page. If the person needs to
search the whole thing, send it whole with step 3 alone - measured, it holds up
to tens of thousands of rows. `/examples/large-diff` has the numbers.

## Deciding which regions are places

`ko-history` means **this region is a place** — content landing in it changes the
address bar. It is *not* inherited: a panel inside a page says so itself or says
nothing.

Putting a URL in the address bar is a promise: **GET on it returns what is on
screen.** Only add `ko-history` where the server can keep that promise.

- A section of an application, a record, a search with its terms — **yes**.
- A tab within a record, a panel refreshing beside what you are reading, a step
  in a wizard that only makes sense in order — **no**.

A region with no `ko-history` still routes, still swaps, and can still take focus
when the person picks something — say so with `ko-focus="region"`. *Where you
should be looking* and *what the URL should say* are different questions.

Getting this wrong is not subtle: the address bar fills with URLs that reload
into something else, and the page jumps to the top every time a tab changes.

**Do not write a screen that decides this at runtime.** Whether a URL is a place
is a fact about your server, so mark it and leave it marked. Whether the address
bar is *available* is a fact about the page, and if your application is ever
embedded, that page is not yours — its host says so with `ko-history="none"` on
the container, which reaches downward and overrides every claim below it. So:

- Serve the same markup embedded and standalone. An `embedded` flag threaded
  through a renderer is a sign this got backwards.
- If you are the host, put `ko-history="none"` on the panel. Nothing is asked of
  the application you embed, which is the point.
- If you are a host with no address bar — a native shell — or you present the
  panel as a subwindow with its own chrome, use `ko-history="local"` instead. It
  refuses the address bar the same way and keeps what it refused as a stack.
  Show it: `--koda-back` / `--koda-forward` buttons, styled from `ko-can-back`
  and `ko-can-forward`, and in a shell route the system back gesture to
  `back()`, falling through to the shell's own back when `moved` is false. In a
  browser with an address bar, compose the panel into the host's URL instead.

## Building something a host can embed

If a screen might ever be a panel on somebody else's page, these make it safe,
and none of them costs anything when it is standalone:

- **`ko-item` on the application's root.** Inside an item, `query()` searches the
  item, and a name — in an expression, in `ko-target`, in the `ko-into` your
  server writes — resolves there before the page. Declare your parts with
  `ko-as` and contribute no global ids at all. For a total over a grid, use
  `grid('.line')` rather than `page('.line')`: it searches only the `ko-grid`
  it is in, so another panel's rows never end up in your sum.
- **`@scope (.your-app)` for your CSS, outside every cascade layer**, so
  `.status` and `.bar` stop at your panel and your rules beat the design
  system's and the host's without a specificity contest. Every colour, space
  and radius is a design-system token, never a literal, so the host's theme
  reaches you; link the design-system version you were built against from
  your own fragment. The `koda-styling` skill has the whole arrangement.
- **`container-type: inline-size` and `@container`, never `@media`.** A media
  query asks how big the *window* is, and a panel does not own the window. A
  panel that pushes the host's page sideways has broken somebody else's layout
  from the inside.
- **Links, forms and assets inside your own URL space.** Leaving it is
  `target="_blank"`. A host routes by space, so a link to somebody else's
  space pulls their fragment into your panel.
- **A part some shell could draw natively gets a URL of its own.** Do not
  feature-detect the shell in a script (`if (window.shell) ...`). Load the part
  as a `ko-source` region and let its server answer in HTML or in a media type
  a native shell registered a renderer for. Your markup and your script stay the
  same in every host; `koda-composition` has the rest.

And if you want to use something the host *might* provide — a drawer, a modal,
a place for notices — ask for it, do not assume it:

```html
<a href="/policy/rules/window" ko-target="drawer?">Claimed within 45 days</a>
```

A miss routes by scope instead of refusing, so the same markup opens the rule
in the host's drawer or in the app's own pane, with nothing branching. Two
things to get right:

- **The fallback is a scope, not a region of yours called `drawer`.** A name
  inside your `ko-item` resolves before the page's, so naming your own fallback
  after the affordance means you shadow the host and never see it.
- **Do not let the fallback's scope contain the URL your panel loads from**, or
  refreshing the panel routes the whole application into its own detail pane.

The same question mark works on `ko-into`, asked by your *response* rather than
by the page — for a sentence you would like shown somewhere and can live
without:

```html
<div ko-into="notice?"><p>Claim approved.</p></div>
```

A miss here **drops** the fragment rather than falling back into the panel, and
says so through `onNavigate`. Use it only for what is genuinely losable: the
record's own status should already say what happened, with the notice as the
courtesy. A fragment that has to arrive goes without the question mark.

The same markup can arrive **unasked, down a channel**. A `ko-connect` message
that starts with `<` is delivered exactly like this, so a server that wants to
say something on its own schedule - a reminder, "someone else edited this" -
pushes `<div ko-into="notice?">…</div>`. Do not put a hidden control on the page
whose only job is to hear an event and show a banner. Every top-level element
of a pushed message needs `ko-into`: nothing asked, so there is nowhere by
default.

Two more things an answer can say about a region, each with no hidden
element and no script:

- **Close the panel that asked** - save in a drawer, refresh the row, close the
  drawer - with an empty envelope for it: `<div ko-into="drawer?"></div>`
  beside the row's. The drawer is emptied and forgets the editor's URL and its
  Back, as `--koda-empty` would.
- **Take a region away** - a row somebody else deleted, a tile moved to another
  list - with `<div ko-into="cmp-7" ko-attach="remove"></div>`. Only in an
  answer: on a link or a button it is refused, because it would remove the row
  even when the server says no.

When the *content* should differ rather than the plumbing — a hint that only
makes sense on a host without the thing — ask outright:

```html
<p class="hint" calc-hidden="affords('drawer')">Rules open below the list.</p>
```

Rarely, though. The question mark is what lets a screen work on a host nobody
has built yet; a screen full of `affords()` has re-invented capability
detection. One hint is a good use, two code paths is a warning.

## Traps

Each of these has cost somebody an afternoon.

- **A hyphenated attribute in `ko-set` is a string subscript.** `row.data-state`
  parses as a subtraction. Write `row['data-state'] = 'open'`.
- **`encode()` when a binding builds a URL.** `'/search?q=' + q.value` breaks the
  moment somebody types `&`, and breaks quietly.
- **A binding writes its own element and nothing else.** To make a frame follow
  its content, have the frame *ask*: `<body calc-data-chrome="at('/tutorial') ? 'bare' : null">`.
  Ask who wants to know before you build a way to tell them.
- **Two `calc-value` bindings pointing at each other are not two-way.** Both are
  derived, neither is a source, and whichever effect runs first wins. Two-way is
  two *actions*.
- **One `<style>` per view, not per row.** A partial rendered fifty times gives
  fifty style elements. Use `@scope` in a panel; put row rules in the page.
- **Ids are global.** Inside `ko-item`, `qty` means *this row's* — so a repeated
  partial needs no numbered ids and stays one constant string. Reach for
  `ko-item` before interpolating an id. The same goes for whole applications:
  one `ko-item` on the root and `ko-as` on its parts, and it can be rendered
  twice on one page without either copy reaching into the other. The platform's
  own references - `commandfor`, `popovertarget`, a label's `for` - take ids, so
  write `ko-for="confirm"` instead: Koda finds this row's `confirm` and writes
  the id for you. A row's menu, its Delete dialog and its labels then need no
  id at all.
- **A list the person puts in order is fields in an order, not a script.** Put
  a hidden input carrying each row's id inside the row, and give the row
  `<button command="--koda-move-up" ko-for="levels">` and its `-down`, `-first`
  and `-last` siblings. The button names the list and moves the row it is in,
  keeps the focus, and raises `change`, so the form posts the new order on save,
  or as it goes with `ko-invoke="change"`. Do not fall back to a position
  number field, or drop the feature: these are the keyboard half of reordering.
  For the pointer half, add `ko-drag="levels"` to the row (it names the list
  like `ko-for`) and style `[ko-dragging]` and `[ko-drop-target]`. Put
  `touch-action: none` on a grip, not the whole row, and keep the move buttons,
  because a list that only drags is one some people cannot arrange. For rows that
  move *between* lists, such as a board's columns, put `ko-move-group="card"` on
  each list and use `--koda-move-next-list` / `--koda-move-previous-list`. Give
  each column a `ko-item` that declares its key (`<input type="hidden"
  ko-as="lane" value="doing">`) and give each card a field bound to it
  (`calc-value="lane.value"`), so the form posts each card's column. Do not call
  that field `lane`: a name resolves nearest first, and the field would be
  reading itself. Aim the save at a status line, not back at the board.
  `/examples/board` is the whole thing.
- **A client guard must agree with the server about what is visible.** Guarding
  a submit on two of the server's three rules leaves a button that invites a
  click it can only refuse. Guard on everything the person can see and fix; let
  the server decide, and show what it says when the two disagree.
- **Linking out of a shell that owns `/`.** A `/`-scoped region claims every URL
  on the origin, including another application's. Use `target="_blank"` — Koda
  leaves a link with a target alone — or the other app's *fragment* is pulled
  into your page without its own chrome.
- **Chaining chunks instead of slotting them.** Ending each chunk with the
  region that fetches the next looks simpler, and can never reach the end: the
  region at the bottom loads a chunk, which pushes the next region out of view.
  Pressing End shows the next 500 lines, not the last ones.
- **A table row out of band travels in a `<template>`.** An answer is parsed as
  HTML, so `<div ko-into="line-l2"><tr>…</tr></div>` loses the row's cells, and
  a `<tbody>` after other content is dropped - silently, as an empty row. Send
  table parts as `<template ko-into="line-l2"><td>…</td></template>`, in any
  order; `div` stays right for everything else.
- **"Running" belongs on the button, and needs no script.** A control whose
  request is in flight carries `ko-busy`, even when the answer lands in the
  whole page - style `[ko-busy]` beside it. Pressing again while it waits is
  already harmless.
- **In a script, a ref's states are read-only.** `pick.selected` and
  `panel.hidden` read as they do in an expression; to change one, write the
  element (`panel.element.hidden = false`) or say it in markup.
- **Testing a formatted field:** click, select all, then type. A `ko-format`
  field swaps its display for the raw value when it takes focus, so a test
  helper that sets the value lands its text *after* what is already there and
  you get `34.2120`. A person selects first; so should the test.

## Before you finish

- [ ] No `addEventListener` that a trigger or binding could have expressed
- [ ] No hand-written debounce, and no `setTimeout` standing in for one
- [ ] No client-side template for something the server could render
- [ ] The server's markup is in view files, not strings built in handlers
- [ ] Every `<script>` inside a fragment is `type="koda"`
- [ ] Anything attached outside the script's own content is undone in `onRemove`
- [ ] `ko-history` only where that URL answers as a whole page, and stated
      unconditionally — no `embedded` flag deciding it at runtime
- [ ] The screen still works with JavaScript disabled, or degrades to a reload
- [ ] It imports, renders and inlines nothing from another deployable - shared
      code is a versioned package, another team's icon is a file you link
- [ ] It looks right with the host's stylesheet switched off
