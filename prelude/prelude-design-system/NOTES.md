# Prelude Design System - notes

Prelude's own design system: the vocabulary of Prelude's screens (folders,
designs, sessions, the design surface), drafted from what Prelude already ships:
`server/public/ds/v1/` (tokens, components, icons) and `server/public/prelude.css`
(Prelude's own patterns). Gallery: `screens/01-tokens`, `02-components`,
`03-guidelines`; `styles.css` is the gallery's own layout only.

## Decisions

- **Look unchanged.** Same OKLCH palette (warm neutrals, sienna accent), type
  scale, 4px space step, radii and shadows as ds/v1 - it's what Prelude looks like.
  Only change: light `--warn` darkened (0.6 → 0.55 L) so warn text reads on white.
- **Prelude's own patterns promoted to components**: list/item, menu, segmented
  (was `.mode-switch`), toolbar (`.design-bar`), panel (`.chat`/`.design`),
  notice (`.host-approval`, confirm cards), status + pulse, transcript, composer,
  prose (`.markdown`), empty, crumbs, disclosure, choices. Page layout
  (`.page`, `.workspace`, `.bar`) left out: it's the app shell's.
- **Compact controls by default.** ds/v1's default button was 3.25rem and primary
  4rem (mobile-sized), and Prelude overrode it everywhere with `.small` plus local
  heights. Now `.btn` = `--control-md` (2.5rem, same as inputs, so `.inline` lines
  up), `.small` = 2rem for toolbars, `.large` = 3.25rem. Primary is a colour, not a size.
- **Renames for clarity / one name per thing**: `.f`→`.label`, `.err`→`.error`,
  `.sec`→`.secondary`, `.rowbtns`→`.actions`, `.iconbtn`/`.icon-btn`→`.icon-btn`,
  `.hard`→`.danger`, `.linkish`→`.link-btn`, `.pill.ok/.bad`→`.good/.danger` (+`.warn`,
  `.accent`), `table.data`→`.table`, `.markdown`→`.prose`, `.area`→`.group-label`,
  `.span2`→`.wide`, `.kinds .check`→`.choices .choice`. Added `.hint`.
- **Layout primitives**: `.stack`, `.cluster`, `.grid`, `.split` (main + `.side`),
  `.center` (`.narrow`). Prelude had no general helpers (only `.rowbtns`,
  `.inline`, `.fields`, `.page`), so these take the common names. Prelude's
  workspace (chat beside design) is a `.split`; its `.page` is a `.center` + `.stack`.
  Gap is `--gap`, set by `.gap-0…10` or `style="--gap: var(--space-…)"`; each
  primitive sets its own default so nested ones don't inherit it; the `.gap-*`
  rules sit last in the layer so they beat those defaults (and `.card`'s).
  No `@media`: wrap, auto-fill, flex-basis.
- **Blocks have no outer margins** (guideline 8). Base resets h1–h4, p, lists etc.
  to margin 0; `.card`, `.field`, `.notice`, `.composer` stack their own parts
  with gap. `.actions` is now only a modifier: a row of buttons is
  `.cluster.actions`. A `.notice`'s words go in `<p>` (it's a flex column).
  `.prose` is the one exception: it spaces rendered markdown itself.
  `.inline` and `.fields` stay as form components.
- **Ghost buttons are borderless** (were bordered), so toolbars are quieter.
- **New tokens** to keep literals out of components: `--backdrop`, `--space-half`,
  `--control-sm/md/lg`, `--measure`, `--measure-narrow`, `--border-width`,
  weights, leadings, `--duration-*` (zeroed under reduced motion). Dropped
  `--text-4xl` (Prelude sets no display type).
- **Series colours back** (2026-10-23, the person's decision): `--series-1…5`
  in both themes. They'd been dropped only because nothing used them; flows
  and charts in agent chats need things told apart. Guideline 3: they tell
  things apart, never mean good, warn or danger, and always have a label.
  Hues moved off ds/v1's (blue 255, magenta 335, teal 195, olive 115, violet
  295): ds/v1's first was the accent's sienna and two sat by good and warn,
  so a flow's first part read as "this". ds/v1 should take the new values.
- **Icons**: 32 of ds/v1's Material Symbols, the ones Prelude's domain needs;
  `conversation`→`session`, `activity`→`history`. Pop out should use `external`,
  not `expand` (expand means "show more below").
- **Skeleton** (`.skeleton`, `.title`/`.control`/`.block`, `--w`): placeholders
  for content on its way, pulsing. Added because "Landing Page"
  (prelude/landing-page) loads its regions separately; the shell's gallery drew
  its own and can now drop it.
- **Empty page** (`.empty.page`): a first-run page's empty state, centred in
  the page's height (60svh), with a heading and its action. Added for "Landing
  Page" (prelude/landing-page).
- **Composer attachments** (`.attachments`, `.attachment`, `.thumb`,
  `.attachment-name`, `.composer-tools`, `.composer[data-dropping]`):
  images going with a message as thumbnails, added by Attach, paste or
  drop; the same list shows them in a sent message. The box now grows as
  the person types (`field-sizing: content`, up to 33vh). Added for "Design
  Workspace" (prelude/design-workspace).
- **Chip** (`.chip`, `.chip-text`): a pill-shaped checkbox for something
  going along that the person can leave out; struck through when off.
  Added for "Design Workspace" (prelude/design-workspace): the page on
  show, going with a message.
- **Segmented as radios**: a `.segmented` of labels around `.sr-only`
  radios, the checked one current, for a choice made in a form. Added for
  "Design Workspace" (prelude/design-workspace): the drawing tools when
  marking up an image.
- **Icons `dictate` and `capture`**, drawn for Prelude until Material's
  are copied in (icons/NOTICE.md); and a pressed `.icon-btn`
  (`aria-pressed="true"`): accent, glyph pulsing, for something on and
  working (listening). Added for "Design Workspace"
  (prelude/design-workspace): dictation, and capturing the preview.
- **Menu groups**: `<hr>` between groups, and a small form at the end with
  a real `.btn` (menu row styles now skip `.btn`, which they used to flatten).
  Added for "Design Workspace" (prelude/design-workspace): a custom size.
- **Menu `.up` and `.menu-note`**: a menu that opens above its button (one
  at the foot of a panel would open off the bottom), and a line in a menu
  that says something. Added for "Design Workspace" (prelude/design-workspace):
  the speech model's menu beside the microphone.
- **Menu is a popover** (2026-10-23; was `details`): `.menu` holds a button
  with `popovertarget` and its `.menu-list popover`, anchored with CSS anchor
  positioning (`anchor-scope`, `position-area`, flipping to where there's
  room, so `.up` is only where it tries first). Why: the person wanted the
  usual menu behaviour, and the browser provides it with no script: a click
  outside or Escape closes it (focus back on the button), one open at a time,
  its state told to screen readers, drawn above panels that would cut it off.
  Tab moves through rows; arrow keys wait (see open questions).
- **Wide center** (`.center.wide`, `--measure-wide: 72rem`): a page with a
  side column, whose main column keeps a readable width beside it (46rem
  can't hold a `.split`). Added for "Project Landing Page"
  (prelude/project-landing-page): the project's page, its work beside its setup.
- **Busy** (`[ko-busy]` on `.btn`, `.link-btn`, `.icon-btn` and any link;
  tokens `--delay-busy`, `--duration-spin`; guideline 12): the control
  pressed says it's working while its request is out - after 150ms, a
  spinner beside a button's words, a pulsing glyph or link - with nothing
  per page, since Koda sets the attribute. Only `button[ko-busy]` dimmed
  before, so a link styled as a button (Push and open a pull request…) showed
  nothing. The same rules are copied into ds/v1. Added by the fix "Requests
  seem to take a very long time" (prelude/fixes/requests-seem-to-take-a-very-long-time-even-for-things).
- **Panel head** (`.panel-head`): a panel's toolbar and the notices under
  it as one part, for a head that refreshes apart from the body; its
  notices run edge to edge as a panel's own do. Added for "Design
  Workspace" (prelude/design-workspace): the design bar refreshes when the
  agent changes the design, while the page under it stays as it was.
- **Inset panel body** (`.panel-body.inset`): a body of lists, notices and
  text kept off the panel's edges (a plain body runs edge to edge, for a
  surface that fills it). Added for "Build" (prelude/build): the build
  session's check ran into the panel's edges. It scrolls only up and down:
  a list's rows hang into the padding, which scrolled sideways.
- **Rows to pick** (`label.item` with a checkbox first): a list whose rows
  are chosen, not opened; the whole row is the label. Added for "Project
  Landing Page" (prelude/project-landing-page): choosing what to clean up.
- **Map** (`.map`, `.map-layer`, `.map-label`, `.map-nodes`, `.map-node`
  with `.outside`, `.warn`, `aria-current`; `--label`, `--node-min`): the
  parts of something in layers, read top to bottom, each part a link. The
  label goes above its parts in a narrow map (container query). Added for
  "Architecture" (prelude/architecture): a project's parts. Its words
  (architecture, part, decision, flow) are in the Words table too.
- **Rich visuals in agent chats** (2026-10-23), for D-v3x's `prelude-flow-1`
  and `prelude-map-1`:
  - **Flow** (`.flow`, `.many`, `.flow-title`, `.flow-parts`, `.flow-part`,
    `.flow-steps`, `.flow-step`, `.flow-box`, `.flow-text`, `.flow-pass` with
    `.back`/`.down`; `--lanes`, `--lane`, `--series`, `--from`, `--to`): a
    column per part over its line, a row per step, what's handed on as an
    arrow. Under 34rem (58rem with `.many`, 5+ parts) a numbered list where
    each step names its part, so it fits a chat column; 4 parts get columns
    on a page held to `--measure`. No script: the model gives every number,
    CSS only places.
  - **Map markers**: `.touched` (solid accent, inset stripe, "Changed") after
    a build or fix turn; `.proposed` (dashed accent, "Would change") for an
    ask's proposal; the other parts step back (`:has()`).
  - **Guideline 13, rich components**: the HTML file is the contract, one
    partial per stack renders it from a model, script only if truly
    imperative (`type="koda"`, `ko-as`, `watch`, `onRemove`), no custom
    elements but a host's renderers, gallery in the same turn. Why: the
    person wants every stack to build them the same way.
- **A flow's parts can be links** (2026-10-23): a link inside each column
  head (`tabindex="-1"`: the heads stay aria-hidden) and each step's
  `.flow-part` an `<a>`, shown in its box while it has focus, so keyboard
  and screen-reader users reach the same pages. And `.entry ul` became
  `.entry :where(ul)`: at 0,1,1 it padded every list in a transcript entry,
  the map's parts and the flow's heads included (sent images lose a stray
  indent too). Added for "Design Workspace" (prelude/design-workspace):
  visuals in the chat, each part opening its page in the architecture.
- **Map `.named`** (2026-10-23): a part picked out with nothing said about
  change, accent border, no pill; its note says why it's there. The person:
  an agent's map shouldn't speak of change when there's none. Added for
  "Design Workspace" (prelude/design-workspace): the agent's
  `prelude-map-1` blocks.
- **Words**: Prelude's vocabulary and the words to avoid are in guidelines.md.
  "Project", not "folder" (the person's decision, 2026-10-16); the table was
  changed for "Project Landing Page" (prelude/project-landing-page).

## Open questions

- Should Prelude's own app (`server/public`) move onto this system, replacing
  ds/v1 + prelude.css? The renames above would need a pass over the views.
- A dedicated pop-out glyph, and a copy glyph (Copy all stories), aren't in the set.
- Menus: arrow keys between rows (the person chose to wait; likely Koda's
  job, as script). The app's menus moved to the popover on 2026-10-23 (the
  fix prelude/fixes/the-design-system-s-menu-component-was-changed-to-use-an),
  with `ko-for`/`ko-as` for the ids; the shell's `_regions` closes a menu
  when a row in it is pressed, which a popover alone doesn't.
- Is the dialog needed at all? Prelude confirms in-page with a notice today.
- "What's handed on" in `prelude-flow-1` (the person wants it): an optional
  addition, so no new tag (D-v3x). Suggested: a step may end ` -> <what>`
  (`2. turns: saves it to the transcript -> the entry`), the last ` -> ` on
  the line; the shared flow parser reads it in `flows/*.md` too. It's code
  (visuals, views), so a build or fix makes it; `.flow-pass` stays optional.
- The app draws from `server/public/ds/v1`; the flow, the markers and the
  series values are copied there when they're built (agreed).
