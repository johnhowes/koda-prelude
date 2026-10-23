# Prelude: guidelines

Prelude is a calm workbench: a person and an agent design an app together, and
the design is the thing on show. The interface steps back so the work can stand
forward. Every rule here comes from that.

## Rules

**1. One accent, for "this" and "next".** The sienna accent marks the primary
action, the current choice and links. Nothing decorative is accent-coloured.
*Why:* the person should always be able to find the next step at a glance.
- Do: one `.btn.primary` per view (Send, Create design, Start the app build).
- Don't: two primary buttons side by side, or accent-coloured headings.

**2. Name roles, never looks.** Use tokens (`--fg-muted`, `--surface-sunken`), never
literal colours, spaces or radii, and never write a colour outside tokens.css.
*Why:* both themes, and a host's own palette, come from the tokens alone.
- Do: `color: var(--fg-subtle)`.
- Don't: `color: #888` or `padding: 13px`.

**3. Quiet by default; colour means something.** Text steps back in two grades:
`.secondary` explains, `.muted` annotates. `--good`, `--warn` and `--danger` appear
only when there is something to act on, and never alone: the words say it too.
*Why:* if everything is loud, the one failing check isn't.
- Do: `<span class="pill warn">Behind main</span>`.
- Don't: a red dot with no words, or green for "nothing happened".

**4. Say what happened, then what to do.** Messages are plain sentences addressed
to the person: the fact, then the next step. No blame, no jargon the person didn't
choose, no exclamation marks.
*Why:* the person is often waiting on the agent; every line should move them on.
- Do: "1 page doesn’t render. The agent is told with your next message."
- Don't: "Error: render failed (exit 1)!"

**5. Ask before anything outward or hard to undo.** Pushing, merging, running a
design host: say exactly what will happen and where, in a `.notice.warn`, with the
action in words and a way out ("Not now").
*Why:* the folder is the person's; Prelude never surprises them with it.
- Do: "This pushes `prelude/sign-up` to `origin`, where others can see it."
- Don't: a "Publish" button that pushes straight away.

**6. Buttons say what they do.** A verb and its object, in sentence case:
"Create design", "Push and open the pull request", "Start it". "Choose…" ends in
an ellipsis because it asks for more. Icons go first and are never the only label
unless the glyph is universal (close, zoom), and then with an `aria-label`.
*Why:* the label is the promise; "OK" promises nothing.
- Do: "Merge into main".
- Don't: "Submit", "OK", "Go".

**7. Components answer to their container.** Lay out with flex-wrap, grid and
container queries, never `@media` widths. The page's frame (header, navigation,
regions) belongs to the app shell; what's inside a region is composed from the
layout primitives (rule 8).
*Why:* the same component lives in a page, a chat column and a pop-out window.
- Do: `.fields` goes to one column when its own box is narrow.
- Don't: `@media (max-width: 600px)` in a component.

**8. Compose pages from layout primitives; space comes only from their gaps.**
Every block (a card, a notice, a heading, a form, a list) sits inside a primitive:
`.stack` (one under another), `.cluster` (a row that wraps), `.grid` (equal
columns, as many as fit), `.split` (main and side) or `.center` (a readable width).
The space between blocks is the primitive's gap, chosen from the space scale
with `.gap-*` or `--gap: var(--space-…)`. Blocks have no outer margins; to space
something differently, nest another primitive. `.prose` is the one exception: it
spaces rendered markdown itself.
*Why:* one owner for every space means spacing is the same everywhere, and a
block can be moved without bringing stray margins with it.
- Do: `<div class="stack gap-1"><h3 class="group-label">Onboarding</h3><ul class="list">…</ul></div>`.
- Don't: `style="margin-top: var(--space-4)"`, or a class that adds margin to a card.

**9. Work without script.** Menus are popovers (the browser closes them on a
click outside or Escape), disclosures are `details`, the transcript keeps to the
bottom with a reversed column, filters use `:has()`. Script only for what the
platform can't express (Enter to send, copying to the clipboard).
*Why:* views are server-rendered and swapped in place; script is the part that breaks.
- Do: `<button popovertarget="…">` and `<div class="menu-list" popover>` in a `.menu`.
- Don't: a click handler that toggles a class.

**10. Keyboard and screen reader first.** Every control is a real `button`, `a`
or form control; focus shows the ring; icons are `aria-hidden`; a status line is
`role="status"`, a failure `role="alert"`.
*Why:* the person may never touch the mouse while talking to the agent.
- Do: `<button class="icon-btn" aria-label="Close">`.
- Don't: `<div onclick>`, or removing the focus ring.

**11. Both themes, always.** Every colour is `light-dark()`, and the host sets
`color-scheme`. Check every screen in light and dark.
*Why:* Prelude follows the person's system, and the desktop app does too.

**12. What's pressed says it's working.** Every link and button shows it's busy
while its request is out: Koda sets `ko-busy` on it, and components.css shows a
spinner (or a pulse) after a moment. A page adds nothing for it. A region that's
slow to read on its own arrives later (`ko-defer`, with a `.skeleton`), and
that's rare: a slow answer is first a thing to make fast.
*Why:* a press with no answer reads as a press that didn't take, and gets pressed again.
- Do: `<a class="btn" href="…/publish" ko-target="modal?">`, and nothing else.
- Don't: a "Loading…" label swapped in by script, or a `ko-defer` around a whole page.

## Words

Prelude's words, with the ones to avoid. Sentence case everywhere; curly
apostrophes (’); "…" for something in progress or that asks for more.

| Say | Not | Because |
| --- | --- | --- |
| project | folder, workspace, repo (in the UI) | What the person opens; "a folder, usually a repo" explains it once. A folder the agent may read is still a folder. |
| design | project, mockup, prototype | A design describes one feature and grows over sessions. |
| session | chat, conversation, thread | One sitting with the agent on a design. |
| screen (a static design), page (a route of a hosted design) | mockup, artboard, frame, view | What the person sees; "view" is the code that renders it. |
| state | fixture, mock data, scenario | The data a design's pages are shown with. |
| design system | theme, style guide, UI kit | The app's vocabulary, which every design uses. |
| app shell, layout | template, chrome, frame | The shell holds the layouts every design renders in. |
| the agent | AI, assistant, bot, Claude | It's a role in Prelude, not a brand. |
| architecture | system design, tech spec | The project's parts, principles, decisions and flows, which agents read. |
| part | module, component, service, box | One piece of the architecture, whatever it runs as; "component" is the design system's. |
| decision, proposed, accepted, superseded | ADR, record, RFC | Says what it is to someone who has never written an ADR. |
| flow | sequence, trace | A request or a job, step by step through the parts. |
| build, the app build | generate, compile, deploy | Turning a design into the app's code. |
| story | ticket, task, issue | What's left to build, as text to copy. |
| check, render | test, validate | Prelude renders every page in every state. |
| approve, approve again | snapshot, baseline, accept | Approving saves the screens as they render now. |
| branch, merge, push, pull request | publish, ship, sync | Git's own words, for people who use git. |
| update from main | rebase, sync, pull | It merges main into the branch. |
| finish the branch | close, complete, done | Merge it, or push it for a pull request. |
| what the agent can read | permissions, access, scope | Says exactly what it is. |
| Not now | Cancel, Dismiss | It leaves the door open. |
| Stop | Abort, Kill, Cancel | Stops the agent's turn. |
