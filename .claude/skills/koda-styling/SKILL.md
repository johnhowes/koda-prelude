---
name: koda-styling
description: Write CSS for Koda applications and hosts so every screen looks right standalone, as a panel on somebody else's page, and under a host's theme - design tokens named for their role, one cascade-layer order declared everywhere, application rules scoped and unlayered, container queries for layout, icons as versioned files drawn with a mask and named by token. Use when writing or reviewing CSS for a Koda application or host; when setting up a design system that several teams share, or adding icons to one; when theming a host; when a host's rule is beating an application's, or you are tempted to raise specificity or reach for !important; or when a panel breaks the layout of the page it sits on.
---

# Styling for a page you do not own

An application's stylesheet is loaded on a page somebody else controls, next
to stylesheets it has never seen. Three parties have a say in how a screen
looks, and the whole job is making it explicit which one wins where:

| | owns | expressed as |
|---|---|---|
| **Design system** | the shared vocabulary: colour, type, space, shape, depth, and the common components | tokens and classes, in layers, **versioned** |
| **Host** | the page: its chrome, its brand, light or dark | token values and its own chrome, in the `host` layer |
| **Application** | its own screens | scoped rules, **outside every layer** |

The attribute side of embedding (`ko-item`, `ko-as`, optional affordances) is
in the `koda-app-authoring` skill, and the deployment side in
`koda-composition`. For how Koda itself touches styling - `hidden`, `@scope`
in a partial, the state attributes CSS keys on - see `docs/reference.md`.

## Tokens, named for what they are for

```css
--bg  --surface  --surface-sunken  --border
--fg  --fg-muted  --fg-subtle
--accent  --accent-hover  --accent-fg  --accent-soft
--good  --warn  --danger         --series-1 … --series-5   (charts)
--space-1 …  --radius-sm … --radius-full  --text-xs … --text-2xl  --font-sans  --shadow-md  --ring
```

A role, not a colour: `--accent`, never `--sienna-500`. A host that is blue
sets `--accent` blue and every application follows, because none of them ever
said "sienna". **Tokens are the only thing that crosses between teams.**
Components are built from tokens and nothing else, and an application that
writes a hex value has opted out of every host's theme.

**Put the defaults in the lowest layer**, so they are defaults and not
decisions. A host that sets nothing still gets a palette that works; a host
that sets `--accent` anywhere else wins without thinking about it; and an
application on a bare page, with no host at all, still renders.

**Write each colour once, with `light-dark()`**, so one definition serves both
themes. Which theme applies is `color-scheme`, and that is **the host's to
set**: the page is the host's. An application never sets `color-scheme` and
never asks `prefers-color-scheme`.

## One layer order, declared in every file

```css
@layer tokens, base, components, host;
```

The first statement of every design-system file and every host stylesheet,
identically, so the order cannot depend on which file happened to load first.

| layer | holds |
|---|---|
| `tokens` | the defaults above |
| `base` | bare elements: the page, links, headings, form controls |
| `components` | `.card`, `.btn`, `.field`, `.table` and the rest |
| `host` | a host's chrome, and its own token values |
| *(no layer)* | **an application's own rules** |

The last row is the point. **Unlayered styles beat every layer, whatever the
specificity.** An application's plain

```css
.metronome input { width: 5.5rem; }
```

beats the design system's
`input:not([type=hidden]):not([type=checkbox]):not([type=radio])` full-width
rule without matching its specificity or knowing it exists. A layer
is a statement about who wins; specificity is an accident of how somebody else
wrote a selector. When you find yourself adding a class or an `:is()` to win,
the fix is to move a rule into the right layer, not to outbid it.

`base` is its own layer on purpose. How bare elements look - a full-width
input, a coloured link - is the design system's most surprising opinion and so
the one that most often needs to lose.

**`!important` inverts layer order**: an important declaration in `tokens`
beats one in `host`. Keep it out of layers, with the single exception of
`[hidden] { display: none !important; }` in `base`, which has to beat every
component that sets `display`.

## An application's rules: scoped and unlayered

```css
/* music.css - linked from the application's own fragment */
@scope (.music) {
  .key { background: var(--accent-soft); color: var(--accent); border-radius: var(--radius-full); }
  .metronome { display: flex; gap: var(--space-2); }
  .metronome input { width: 5.5rem; }
}
```

- **`@scope` on the class of the application's `ko-item` root.** `.key` and
  `.bar` stop at the application's edge, and the host's `.key` is untouched.
- **No layer.** It sits above the design system and the host.
- **Tokens for every colour, space and radius.** No literal values that a host
  might want to change.
- **Nothing global**: no `body`, `html`, `:root` or bare `input` outside the
  scope. Those belong to whoever owns the page.
- **One stylesheet for the application, linked**, or one `<style>` with a bare
  `@scope` in a panel that appears once. Not a `<style>` in a partial that
  renders per row.

Only what is genuinely the application's goes here. The card, the button, the
tabs, the stats - if two applications both need it, it belongs in the design
system and gets a version.

## Link the design system you were built against

```html
<link rel="stylesheet" href="/ds/v1/tokens.css">
<link rel="stylesheet" href="/ds/v1/components.css">
```

From the application's own fragment, not trusted to the host. The application
was built against `v1`; a host happening to have loaded it is a coincidence
that will end. Linking it again where the host already has is harmless - the
same rules, cached. A breaking change is `v2`, served beside `v1`, and each
application moves when its team is ready. Say which version in the manifest.

## Hosts theme with tokens, and only tokens

```css
@layer tokens, base, components, host;

@layer host {
  :root {
    --accent:      light-dark(oklch(0.52 0.15 255), oklch(0.74 0.12 250));
    --accent-soft: light-dark(oklch(0.95 0.03 250), oklch(0.30 0.06 255));
  }
  .sidebar { … }      /* the host's own chrome */
}
```

The host puts its whole stylesheet in `host`, so every application still beats
it. It never styles an application's classes. If a host needs to reach inside
an application to make it fit, a token is missing - add it to the design
system rather than writing `.music .key` in the host.

## Layout: container queries, not media queries

```css
@scope (.music) {
  :scope { container-type: inline-size; }
  @container (width < 30rem) { .metronome { flex-direction: column; } }
}
```

A media query asks how wide the *window* is, and a panel does not own the
window. The same screen is a full page in one host, a third of a dashboard in
another and a phone's width in a shell. A host may use media queries for its
own chrome; an application uses containers.

## Icons: files, drawn with a mask, owned like everything else

An icon is an SVG file, and it is drawn by masking a box filled with
`currentColor`. It takes the colour of the text around it (muted in a list,
`--accent` when selected, the forced colour in high contrast) and is cached like
any other file. Which file, and who ships it, depends on whose icon it is:

| icon | examples | owned by | lives at |
|---|---|---|---|
| **Identity** | the application's icon in a hub's sidebar | the application | its own space, named in its manifest |
| **Shared glyph** | close, search, more, expand, next, external, warning | **the design system** | `/ds/v1/icons/close.svg`, in the version |
| **Domain glyph** | metronome, tempo | the application | its own space, `/music/assets/icons/` |

The promotion rule is the one for components: when a second application needs
a glyph, it moves into the design system and gets a version.

### The design system ships a token per glyph and one component

```css
@layer tokens, base, components, host;

@layer tokens {
  :root {
    --icon-close:  url(/ds/v1/icons/close.svg);
    --icon-search: url(/ds/v1/icons/search.svg);
  }
}

@layer components {
  .icon {
    display: inline-block;
    inline-size: 1em; aspect-ratio: 1; flex: none;
    background-color: currentColor;
    mask: var(--icon) center / contain no-repeat;
    forced-color-adjust: none;
  }
  .icon-close  { --icon: var(--icon-close); }
  .icon-search { --icon: var(--icon-search); }
}
```
```html
<button class="btn" aria-label="Close"><span class="icon icon-close"></span></button>
```

The glyph's URL is a token, so an icon set is themed exactly as colour is: a
host that wants its own drawing of "close" sets `--icon-close` in its `host`
layer, and every application follows without a change to its markup.

A domain glyph is the same component with the application's own file, inside
its scope:

```css
@scope (.music) {
  .icon-metronome { --icon: url(/music/assets/icons/metronome.svg); }
}
```

And an identity icon is drawn by the host with the URL from the manifest:
`<span class="icon" style="--icon: url(/music/assets/icon.svg)"></span>`.

### What each detail is for

- **Named for meaning, not shape.** `close`, `expand`, `next`, `delete` - not
  `x`, `chevron-down`, `trash`. The same reason as `--accent` over
  `--sienna-500`, and it is what makes versioning work: adding a glyph, or
  redrawing one that keeps its meaning, is `v1`; removing one or changing what a
  name means is `v2`.
- **`1em`**, so an icon sizes with the text beside it. A bigger icon is bigger
  text, or an `inline-size` on the application's own rule.
- **One grid, drawn by the design system.** One viewBox, one stroke weight, so
  glyphs from different teams sit together. A domain glyph is drawn to the same
  grid.
- **One colour.** A mask can draw nothing else. Anything multi-coloured is an
  illustration and goes in an `<img>` with an `alt`.
- **Root-relative URLs in the token.** A relative `url()` in a custom property
  is resolved where it is used, not where it was declared, so it breaks in the
  first stylesheet that lives somewhere else.
- **`forced-color-adjust: none`.** In forced-colours mode the browser replaces
  `background-color`, and a masked icon without it vanishes. With it,
  `currentColor` still follows the forced text colour.
- **The name is on the control.** The `<span>` is decoration and says nothing;
  the button has `aria-label` or visually hidden text. An icon with no control
  around it that means something needs `role="img"` and an `aria-label`.

### Not inline SVG, a font or a sprite

- **Inline SVG** puts the drawing in every row of every fragment, is a copy
  that stops updating when the design system redraws it, and cannot be themed
  by a host. Never paste another team's SVG markup into your template.
- **An icon font** is text to a screen reader, breaks invisibly when the font
  does not load, and is a second system for something a file already does.
- **A sprite with `<use href="sprite.svg#close">`** works only from the same
  origin and puts markup back in the fragment. One small file per glyph is
  cheap once cached.

## Long content: let the browser skip it



A screen with thousands of rows, or a diff of a huge file, is sent in chunks,

and each chunk is `content-visibility: auto` (the `koda-app-authoring` skill has

the markup side under **Long content**):



```css

@scope (.diff) {

  .line  { line-height: 20px; white-space: pre; }

  .chunk {

    content-visibility: auto;

    contain-intrinsic-block-size: auto calc(var(--lines) * 20px);

    min-width: max-content;

  }

  .slot  { height: calc(var(--lines) * 20px); }

}

```



The browser skips layout and paint for chunks off screen, and the text stays in

the page for find, selection and screen readers. At 200,000 lines this took

re-laying-out the page from about 24 seconds to 150ms. Three details, each of

which is a bug if left out:



- **`auto` in the intrinsic size** means "remember the real height once laid

  out". Without it a chunk that scrolls away snaps back to the estimate and the

  scrollbar jumps.

- **`min-width: max-content`**, because a skipped chunk is clipped to its own

  box. Without it the ends of long lines are cut off, not scrolled to.

- **A fixed line height**, because the estimate and a slot's height are both

  lines × height. With wrapping on, or rows of varying height, the estimate is

  short and a chunk arriving above the viewport pushes the text down. Scroll

  anchoring usually hides it; not in every browser.



## The bare-host test

Before calling a screen finished, look at it three ways:

1. **Without the host's stylesheet.** Disable it in developer tools, or load
   the application's fragment on a page with only the design system. It should
   look right, not merely readable. If it does not, it was leaning on the host.
2. **Under a different theme.** Set `--accent` to something garish and switch
   `color-scheme` to the other theme. Anything that did not change hard-coded a
   value.
3. **Narrow.** Put the panel in a 320px container, not a 320px window. Nothing
   should push the page sideways.

## Traps

- **An unlayered host stylesheet.** It then beats every application. The host
  goes in `host`.
- **Winning by specificity.** A longer selector to beat the host means a rule
  is in the wrong layer.
- **A literal colour in an application.** It survives every theme but one.
- **`prefers-color-scheme` or `color-scheme` in an application.** The host
  decides light or dark.
- **`@media` for an application's layout.** Use `@container`.
- **An application styling `body`, `:root` or bare elements**, or setting
  tokens for the page. Those are the host's.
- **A host styling an application's classes.** Add a token instead.
- **A copied SVG or copied component CSS.** Link the file; version the
  component.
- **An icon named for its shape**, or a glyph two applications both ship.
  Name it for what it means and move it into the design system.
- **A masked icon without `forced-color-adjust: none`.** It disappears in
  high-contrast mode.
- **A relative `url()` in an icon token.** It resolves against whichever
  stylesheet uses it.
- **`content-visibility` without `min-width: max-content`** on content that
  scrolls sideways. A skipped chunk is clipped to its box, so long lines lose
  their ends.

## Before you finish

- [ ] Every colour, space and radius in an application is a token
- [ ] Every shared file begins `@layer tokens, base, components, host;`
- [ ] The application's own rules are unlayered and inside `@scope` on its root
- [ ] The application links the design-system version it was built against
- [ ] The host's stylesheet is entirely in the `host` layer and sets tokens, not application classes
- [ ] No `@media` in an application; the root is a container
- [ ] Icons are files drawn with `mask`; shared glyphs come from the design
      system's tokens, domain glyphs from the application's own space
- [ ] The screen passes the bare-host test
