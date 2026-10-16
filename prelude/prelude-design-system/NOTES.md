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
  `--series-*` and `--text-4xl` (Prelude draws no charts or display type).
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
- **Words**: Prelude's vocabulary and the words to avoid are in guidelines.md.

## Open questions

- Should Prelude's own app (`server/public`) move onto this system, replacing
  ds/v1 + prelude.css? The renames above would need a pass over the views.
- A dedicated pop-out glyph, and a copy glyph (Copy all stories), aren't in the set.
- Is the dialog needed at all? Prelude confirms in-page with a notice today.
