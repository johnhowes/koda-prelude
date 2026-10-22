---
name: koda-composition
description: Build a system of Koda applications that separate teams deploy independently and that one or more hosts compose into a single experience - what an application publishes, what a host may assume, how they find each other, and how code, sign-in and offline are shared without shipping together. Use when designing more than one Koda application that must work together; when building a hub, dashboard, portal or native shell that shows other applications' screens; when adding an application to a host; when tempted to import another application's module, template or SVG; or when a change to one application seems to need a redeploy of another.
---

# Many applications, many hosts

Koda's region model makes composition cheap: a region owns a URL space, and
anything that answers HTML in that space can fill it. The cheapness is a trap as
much as a gift. It is just as easy to build five applications that only work
because they were deployed together, and that is the design this skill exists
to prevent.

For the attributes, read `docs/reference.md` in the Koda repository. This is
about the boundaries between the things that use them. For how each server
answers, see the `koda-server-setup` skill; for the CSS side of the same
boundary, `koda-styling`.

## The rule

**Every node deploys alone.** The test is concrete: can the team that owns one
application ship it on a Tuesday without anybody else redeploying, restarting,
or editing anything beyond a list of origins? If the honest answer contains
"and then update the hub", that is where the coupling lives.

A single process that bundles every service - a desktop app that starts them
all, a monorepo's dev script - is a packaging choice and can be fine. It must
not be the only way the parts work. Keep the bundle as one deployment among
several, and keep the code as if it were split.

## Two roles

| | owns | knows about the other |
|---|---|---|
| **Application** | one URL space and what it answers there; its data; its screens | nothing - it cannot tell which host, or whether there is one |
| **Host** | the page: chrome, address bar, theme, sign-in session, offline, notifications | only an origin, and what that origin publishes about itself |

A host is not special code for each application. A second host in front of the
same applications - a dashboard beside a hub, a native shell beside a browser -
is the proof that the boundary is real. Build one early; it finds the coupling
the first host was hiding.

## What an application publishes

- **One URL space, and only that.** Every link it renders, every form action and
  every asset lives under its own prefix (`/music/...`). Leaving it is explicit:
  `target="_blank"` for another application's page.
- **Fragments.** Behind a host an application has one shape. The host always
  asks for the fragment and wraps it in its own page; the application renders
  no shell, no navigation and no `<html>`. (Standalone, the same application
  would answer both shapes - see `koda-server-setup`.)
- **A manifest at a well-known path**, versioned, saying everything a host needs:
  an id, a name, the space it owns, its home URL, its icon, the assets worth
  keeping offline, the design-system version it was built against, and any hook
  a host may call. This is the only thing a host learns about it.
- **`x-koda: 1` on its own answers**, which the host passes through, so a
  refusal of the application's is still told apart from the host's own errors.
- **Its own assets**, inside its own space: stylesheets, SVG icons as files,
  scripts. A host links or proxies them. It never copies them into its own code.
- **One `ko-item` root with `ko-as` parts**, no global ids, `@scope` CSS and
  container queries - so it can be one panel of several on a page it does not
  own (the embedding section of `koda-app-authoring`).
- **Optionally, a second representation of one thing**, for hosts that can draw
  it themselves: a media type of its own, at a URL of its own, written down as a
  contract. See "Drawing one part natively" below. It never ships the code that
  draws it.

## What a host does

**It is configured with origins, and its code names no application.** An
ordered list - `APPS=https://music.example,https://workout.example` - and the
rest comes from each manifest. Adding an application is configuration.

**It reads each manifest as somebody else's file.** Nothing in one is used
until it has been checked:

- the manifest version is one this host understands;
- every path it names is inside the space it claims;
- that space is not one the host serves itself (`/assets`, `/settings`, the
  service worker, the well-known path);
- the first application to claim a space keeps it;
- **the origin is where the manifest was fetched from, never a field in it** -
  a manifest that could name an origin could point the host's traffic anywhere;
- paths that end up in markup or CSS `url()` are plain paths, with nothing that
  could close a quote or a bracket.

Keep the last good copy of each one. An application that is down when the host
restarts should still be in the navigation, and say that it is down, rather
than silently disappear.

**It proxies each space, and lets little cross.** A short allow-list each way:

| in | out |
|---|---|
| `content-type`, `accept`, `accept-language`, `x-koda-request-id`, `x-koda-queued-at`, the token it made for this application | `content-type`, `location`, `content-disposition`, `cache-control`, `vary`, `x-koda` |

When the host adds its own `Vary: x-koda-fragment`, it **adds it to the
application's**, never sets it over the top. An application that negotiates
says `Vary: accept`, and a host that drops or replaces that has told every cache
in front of it that the URL has one representation.

Always send `x-koda-fragment: 1` onward, whatever the browser asked, and take
redirects as answers (`redirect: 'manual'`) so the `Location` reaches the page.
**Do not forward the browser's cookies or `authorization` header.** The
host's cookie is the host's, and an application that could see it could act as
the host.

**It decides "page or asset" from the answer, not the URL.** When a cold
navigation reaches an application's space, ask the application and look at
what came back: a `200 text/html` is a fragment, to wrap in the host's page;
anything else - a stylesheet, an SVG, JSON, a file - passes through untouched.
Guessing from the path (`/assets/` means a file, no extension means a page)
works until an application names things differently, and then the host serves
its whole page in answer to a request for somebody else's stylesheet.

**It offers affordances and never requires them.** A drawer, a notice area, a
sign-in prompt: the host provides a region with the name, and applications ask
with `ko-target="drawer?"` or `ko-into="notice?"`. A host that has no drawer
is still a valid host.

**A development host shows advice.** A host where applications are designed or
tested - a design tool, a staging hub - puts `<ol ko-warnings></ol>` somewhere
visible. Koda then lists, as they happen, the answers that landed somewhere
other than where their request was routed - a redirect out of a panel, a panel
replaced while its request was out - each saying why. A production host leaves it out. The application ships nothing for
this. See *Advice* in the reference.

**It owns the address bar.** Put `ko-history="none"` on a panel's container
where the host's own URL is the place, or `ko-history="local"` for a panel with
its own back and forward (a dashboard tile, a native shell). The application
serves the same markup either way.

**It serves the design system at versioned paths** (`/ds/v1/...`, and `/ds/v2/`
beside it when that arrives), icons included, and themes it by setting tokens -
the icon tokens too, if it wants its own drawing of "close". It does not
style an application's classes. See `koda-styling`.

## Sharing code without shipping together

- **Never import from another deployable's directory.** `../../hub/lib.js`
  compiles today and couples two release schedules forever, and it breaks the
  day the two are packaged apart. What two teams need goes into a **versioned
  package**: a design system, a kit of helpers, a gateway for hosts. Each
  consumer upgrades when it chooses, and two versions can run side by side.
- **Never render another team's template or inline their SVG.** Link to it or
  fetch it from them. A copy is a fork nobody agreed to. A glyph that two
  applications both draw is a design-system icon, not a file one of them
  borrows from the other.
- **Keep a package's dependencies bare** (`import 'eta/core'`, not a relative
  path into `node_modules`). A browser needs an import map, or a small rewrite
  by the host that serves the module - either lives in the host, not in the
  package.

## Signing people in

Put identity in an application of its own, which every host is a client of,
rather than in any one host.

- **The host keeps a server-side session** under a cookie **named for that
  host**. Browsers share cookies between ports on one machine, so two hosts on
  `localhost` with one cookie name sign each other out; on separate hosts the
  distinct name costs nothing.
- **Each application gets its own short-lived token.** The host trades its
  session's token for one whose audience is that application (OAuth token
  exchange, RFC 8693) and sends it as a bearer token. The application checks it
  against the identity service's published keys and **believes nothing else** -
  not a header the host sets saying who the person is. So an application cannot
  be lied to by a host, and a token stolen from one application opens no other.
- **When the application cannot tell who is asking, it answers `401` with
  `x-koda: 1`.** Koda keeps what the region showed, marks it
  `ko-unauthorized`, and keeps the request for `--koda-retry`; the host offers
  somewhere to sign in with `ko-into="signin?"`, and signing in (a popup, so
  the page and its unsaved work stay put) retries it.
- **Say whose the page is with `<meta name="koda-principal">`**, so a queued
  submission is only ever sent by a page signed in as the person who made it.
  Keep offline copies per person, and clear them on signing out.

The reference covers both mechanisms under "When the application cannot tell
who is asking: 401" and "Whose it is".

## Offline

**The host's service worker is generic.** It keeps copies of what the
manifests listed and of the pages people visited, and it holds Koda's outbox
for writes. **It runs no application code.** An application's deploy should
never require the host's worker to change, and a worker that imports an
application's module has made the host redeploy with it.

A worker that builds a page for someone arriving cold, by putting a stored
fragment inside the host's shell, does it only for a stored `text/html`. A
region on a page with a native renderer may have fetched some other type, and
that copy is not a fragment.

The design system's files - its stylesheets and every icon in the version -
are the host's to keep, since no application's manifest lists them. The design
system publishes that list beside its files, so a host's worker reads it rather
than knowing the icons by name.

The application's part is to list what is worth keeping offline, and on the
server to dedupe on `x-koda-request-id` and record `x-koda-queued-at` (see
`koda-server-setup`), because a replayed write may be one that already landed.

## Native shells

A desktop or mobile shell is **a host with no address bar**, pointed at a
host's URL rather than bundling the applications:

- allow the web view to reach that one origin, and nothing else;
- use `ko-history="local"` for panels, and route the platform's back gesture to
  the stack;
- expose native features through one small bridge object that pages feature-
  detect (`if (window.shell?.notify) ...`), the same way a screen asks for an
  affordance. The web page must still work in a browser without it.

### Drawing one part natively

A shell can draw one part of an application with native code and leave the
rest as HTML, and neither the application nor the host page branches on which
shell it is in. It is content negotiation, with the renderer registry as the
seam:

1. **The application offers a second representation** of that part at its own
   URL: its HTML as before, or - to a request that names it - a media type of
   its own, such as `application/vnd.acme.metronome.v1+json`. Facts to draw from
   (tempo, beats per bar), not layout. That response alone says `Vary: accept`;
   the server details are in `koda-server-setup`.
2. **The part is a `ko-source` region**, so the client fetches it with its own
   `Accept`. Content the host renders into its first paint on the server can
   never negotiate, and nothing will report that it did not.
3. **The shell brings renderers; the host page relays them.** The shell injects
   them at document start, on the host's origin only
   (`window.shell.renderers = { [type]: render }`), and the host page calls
   `registerRenderer` for each **before `start()`** - the regions a page
   declares are fetched by `start()` itself. The host page names no type.
4. **The renderer returns a custom element.** It is attached like any fragment -
   in the page's layout, under its styles - and `disconnectedCallback` is its
   cue to stop what it started when the region moves on. The element talks to
   native code over the shell's bridge, not HTTP.

A browser registers nothing and is sent the HTML from the same URL. Two shells
of different builds negotiate differently from one application, which is the
feature.

What the native half is for depends on the platform. On a desktop the element's
control is still web markup and the native part is what runs behind it; on a
phone, WKWebView cannot put a native view inside the page's layout, so a truly
native surface is a sheet or screen the element opens, or a view laid over the
element and kept in step with scrolling (fragile). Put the native value where
the platform lets it live - audio, haptics, the lock screen - and keep the
inline part simple.

## Traps

- **"Update the hub" in the steps for adding an application.** The host names
  no application; if it has to, the manifest is missing a field.
- **The host deciding shape from the URL.** Decide from the answer's
  `content-type`.
- **An origin in the manifest.** Use where you fetched it from.
- **One session cookie name for every host.** Name it for the host.
- **An application reading `x-user` or the host's cookie.** Only a token the
  identity service signed says who someone is.
- **A service worker that imports an application's code**, or a host that
  inlines an application's SVG or template.
- **Relative imports across packages.** They resolve in the repository and
  break in the packaged layout.
- **A host that sets `Vary`** instead of adding to it, or a proxy allow-list
  without `vary`. An application's `Vary: accept` disappears.
- **A negotiated part rendered into the host's first paint.** It has no client
  `Accept` behind it; give it a `ko-source` region.
- **An application shipping a renderer.** Renderers are the host's - trust, and
  one `Accept` string per shell build rather than one per page composition.
- **An application's link to `/`** or to another application's space without a
  target. A `/`-scoped host region takes it, and pulls the other application's
  fragment into this one's panel.

## Before you finish

- [ ] A new application can be added by editing one list of origins
- [ ] A second host in front of the same applications works, or could
- [ ] Nothing imports across deployables; shared code is a versioned package
- [ ] Every manifest field is validated, and the origin is where it was fetched
- [ ] The host wraps `text/html` answers and passes everything else through
- [ ] The host passes `Vary` back and adds its own to it
- [ ] The browser's cookies never reach an application; a per-application token does
- [ ] The host's service worker runs no application code
- [ ] Each application still renders correctly with no host styles at all (`koda-styling`)
