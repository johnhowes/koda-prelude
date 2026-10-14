---
name: koda-server-setup
description: Wire a server up to serve a Koda application - which request header to read, which response headers to set, how one URL answers in two shapes, and how caching, redirects, antiforgery and file downloads have to be configured. Use when adding Koda to an existing server-rendered application, when setting up routes or a layout for it, when writing the views a server renders or choosing a template engine for them, when tempted to build HTML in a string inside a handler, when a deep link returns a bare fragment or a panel fills with a whole page, when a cache serves the wrong shape, when putting an application behind a hub or other host that proxies it, or when asked what headers Koda expects. Covers ASP.NET, Express and the contract stated stack-agnostically.
---

# Serving a Koda application

Koda is a client-side layer over a server that renders HTML. It asks for URLs
and puts the answers somewhere. The server needs to know almost nothing about
it — but the little it does need is not optional, and getting it wrong produces
failures that look like the library misbehaving.

This is that contract. For what the attributes mean, read `docs/reference.md` in
the Koda repository; none of that is repeated here.

## The one idea everything follows from

**One URL answers in two shapes.**

A region asking for `/orders/1041` wants the fragment. A person pasting
`/orders/1041` into the address bar wants the whole page, with that fragment
inside its shell. Same URL, same handler, same data — two envelopes.

Get this wrong and you get one of the two classic failures:

| symptom | cause |
|---|---|
| A deep link or reload shows a bare scrap of HTML with no styling | Always answering with the fragment |
| A panel fills with a whole page — nav bar, footer and all | Always answering with the document |

## What Koda sends

Every request Koda makes carries:

```
x-koda-fragment: 1
accept: image/svg+xml, text/html, text/markdown, text/plain, text/x-markdown, */*;q=0.1
```

The first is the whole of the required contract. A request without it is a
person, a crawler, a `curl`, or a form submitted after the script failed to load
— all of which want the whole page. There is no JSON, and no version header.

The second is a courtesy you can ignore completely. It lists the media types
this particular client page can render, generated from its renderer registry, so
a URL that has a richer representation for clients able to lay it out can send
it and fall back for the rest. It always ends in a wildcard, so **a server that
never reads it behaves exactly as it would have.** Read it only if you actually
serve a second representation, and if you do, see *Caching* below — it becomes
a cache key.

Requests are ordinary `GET` and `POST` with `credentials: same-origin`, so
cookies and session auth work untouched. Form submissions carry `FormData`,
including files.

You can add your own headers to every request (an antiforgery token, a tenant
id) through the `headers` option — see **Antiforgery** below.

A form marked `ko-outbox` may be sent more than once, and later than it was
made: if it cannot get through, the browser keeps it and replays it. Every such
submission carries two more headers, the same on every attempt:

| header | means | what to do with it |
|---|---|---|
| `x-koda-request-id` | this submission, however many times it arrives | Dedupe on it. A replay may follow a first attempt that *did* arrive and lost its answer. |
| `x-koda-queued-at` | when the person acted, ISO 8601 | Record that, not the time the request arrived. |

## What you must send back

| header | when | why |
|---|---|---|
| `Vary: x-koda-fragment` | any response a cache might store | One URL, two shapes. A cache that does not key on this will serve one to the other. |
| `x-koda: 1` | every response **your application** produces, including your own 4xx | Lets Koda tell your refusal from a gateway's error page. Without it a 422 with a marked field is treated as foreign and not attached. |

Nothing else. No CORS headers (same origin), no content negotiation.

Content type decides how the answer is rendered. `text/html` is the default and
needs no thought. Anything else needs a renderer registered on the client —
`text/markdown` is the worked example in the Koda repo.

## The shape of a handler

Stack-agnostically:

```
handle(request):
    fragment = request.header("x-koda-fragment") == "1"
    body     = render_the_thing(...)          # the same content either way

    if fragment:
        return html(body)

    return html(shell(body, location = request.path))
```

Two rules about the shell:

1. **It contains the fragment**, not a copy of it. One template, used both ways.
2. **The region carries `ko-location`** set to the URL the content came from:

```html
<div id="workspace" ko-scope="/orders" ko-location="/orders/1041" ko-history>
  <!-- the fragment -->
</div>
```

Without `ko-location` the page is a screenshot: it looks right and the next link
routes from nowhere. With it, the region arrives knowing where it is, so links
inside it resolve exactly as they would have if you had clicked your way in —
and it does not re-fetch what it is already showing.

## Views are files, in a template engine

**Write every fragment as a view file, not as a string built in a handler.**
In a Koda application the markup *is* the application: the bindings, the
regions and the forms are all in it. A person who wants to understand a screen
or change one opens its view. If that markup is a template literal inside a
JavaScript function, they cannot find it, their editor cannot highlight or
check it, and a designer cannot touch it without reading code.

It is also a safety rule. A template engine escapes what it interpolates by
default. String concatenation escapes only what you remember to escape, and
the one you forget is an injection.

So:

- **One view per fragment**, named for what it shows (`orders/_detail`), and
  one layout that includes it for a cold load. The handler picks which to
  render, and nothing else about the markup.
- **Handlers pass data, views make markup.** A handler that builds HTML, even a
  little, is a view in the wrong place.
- **Partials for repeated parts.** A row rendered in a list and returned alone
  after an edit is one partial, used in both places, so the two can never drift.

**Use the engine the project already has.** Razor in ASP.NET, Jinja in Flask,
Django's templates, ERB in Rails, `html/template` in Go, Blade or Twig in PHP,
Thymeleaf in Spring. Koda needs nothing from any of them beyond rendering HTML.

**If there is none yet, ask the person which they want before choosing.** It is
an architectural choice they will live with longer than you will, and many
people have a favourite. Offer two or three that suit the stack, recommend one,
and say why. For Node, for example:

| Engine | Why you might pick it |
|---|---|
| Eta | Small, fast, no dependencies; plain HTML with `<%= %>`, escaped by default. |
| Nunjucks | Jinja's syntax: template inheritance and blocks, good for a layout with several regions. |
| Handlebars | Logic-less, so views stay markup and the logic stays in the handler. |
| JSX on the server (e.g. `@kitajs/html`) | For a team that wants type-checked views, rendered to a string with no client runtime. |

Building HTML in code is acceptable only where there is no view to speak of: a
test fixture, or a response of one short line.

## Caching

`Vary: x-koda-fragment` is correct and browsers honour it. **Everything you
deploy in front of the application has to be told separately** — none of it
infers this from the response:

- **CDN** — the header must be part of the cache key. Several vary only on
  `Accept-Encoding` unless configured; the rest need it added explicitly.
- **Reverse proxy** — Varnish, nginx `proxy_cache`: key on what you configure.
- **Framework output cache** — configured apart from the response header. See
  the stack sections below.

The default failure is silent and is the bad one: an intermediary that does not
know the header strips it and caches one variant, so the next person to arrive
cold gets a bare fragment.

**Check it in two minutes.** Through the intermediary, request the same URL
twice — with the header, then without — and look at the second body. If it is
the fragment, that cache is not varying.

**If you cannot make something in the chain respect it, do not let it cache the
HTML.** `Cache-Control: no-store` costs a round trip and is always correct; a
mis-keyed cache is neither.

### If you negotiate on `Accept`

Only if you actually serve a second representation of something. Then that
response — and only that response — also carries:

```
Vary: x-koda-fragment, Accept
```

`Vary` is per-response. Setting it site-wide to serve the one URL that branches
multiplies your entire cache for nothing, and `Vary: Accept` on HTML has a bad
reputation for exactly that reason. It is survivable here because only fragment
requests negotiate and Koda generates their `Accept` in a canonical, sorted
form, so the axis holds a handful of values rather than one per browser build.

Two practical notes. `Accept` is an axis CDNs were built to key on, so it is
more likely to already work — and more likely to be stripped by default, which
silently serves one representation to everyone. Check it the same two-minute
way. And if you want the fan-out smaller, normalise at the edge: an nginx `map`
or a cache-key transform that rewrites `Accept` down to the types you branch on.
`Vary` keys on the raw string, so this cannot be done from the response.

**Look for your type by name.** Koda's `Accept` always ends in `*/*;q=0.1`, so a
wildcard match means nothing about whether this client can draw your format.
Serve the richer body only when its exact type is listed with a q above zero -
not for `*/*`, not for `application/*`:

```js
const names = (accept, type) => String(accept ?? '').split(',').some(part => {
  const [name, ...params] = part.split(';').map(s => s.trim().toLowerCase());
  const q = params.find(p => p.startsWith('q='));
  return name === type && (q === undefined || Number(q.slice(2)) > 0);
});
```

**Version the type in its name** - `application/vnd.acme.chart.v1+json` - not
with a `;v=1` parameter, which Koda strips before it sends the header. Write the
format down beside the application: it is a contract with every host that
chooses to draw it, and a field that changes meaning is `v2`, served beside
`v1`.

**Give the negotiated part its own URL, loaded as a `ko-source` region.**
Anything rendered on the server into a page or a bigger fragment has no client
`Accept` behind it and silently never negotiates. The price is one extra request
per region, for every client.

## Errors

Answer with the fragment and the right status. A `422` carrying the form with
the field marked is the normal way to refuse a save:

```html
<input name="title" value="Widget" ko-invalid-server="Another order uses that title">
```

Koda attaches that, because `x-koda: 1` said it was yours. A response *without*
that header and a 4xx/5xx status is treated as foreign — a load balancer's error
page, a login redirect from an SSO proxy — and is reported rather than spliced
into the panel.

So: set `x-koda: 1` on your own errors. It is the header that makes "the
application refused" distinguishable from "something ate the request".

## Redirects

Nothing special is required. `fetch` follows them, `x-koda-fragment: 1` is
re-sent on every hop, and the final URL decides which region the content lands
in. Post-redirect-get works as designed, and a redirected request records where
it ended up in history.

```
POST /orders/1041/notes   ->  303 See Other
                              Location: /orders/1041
GET  /orders/1041             (still carries x-koda-fragment: 1)
```

Do **not** build the workaround where a handler returns a document containing a
link for the client to follow instead of redirecting. It is not needed.

One thing cannot be known: a response reports that it was redirected and nothing
more, so `303` cannot be told from `307`. Koda reads any redirect as "the result
is at this URL".

## Antiforgery

A Koda form is a form. The token your framework renders into it is one of the
fields the submission collects, so ASP.NET, Rails and Django protections work
unchanged.

Two cases worth knowing:

- A `ko-entry` — an independently submittable part of a form — takes the
  surrounding form's token with it.
- An entry with its own `ko-form` action takes nothing from around it: it is a
  form in all but the tag name, and needs its own token.

**If your token lives in a `<meta>` tag** rather than in the form, add it as a
request header instead:

```js
start(document, {
  headers: () => ({ 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf]').content }),
});
```

A function rather than an object when the token rotates. Koda's own
`x-koda-fragment` is added after yours and cannot be displaced.

`accept` is the exception: it is written *before* yours, so passing one of your
own replaces the generated list. Losing `x-koda-fragment` would turn every
fragment into a whole page silently, which is why that one is not yours to
change; a narrowed `accept` at worst produces a response the client refuses and
reports.

## Files

A response that is a file needs the browser, not the library.

- **A link**: `<a href="/report.pdf" download>` — the platform's own attribute,
  and Koda leaves it alone.
- **A form**: `<form action="/report" method="post" ko-download>` — Koda does
  not intervene, the browser submits normally, sees `Content-Disposition` and
  saves the file.

A routed request reads the body as text, which spoils anything binary. Do not
try to answer a region with a file.

If the file should have a URL of its own, `POST` then redirect to a `GET` that
serves it. Both work; the redirect is worth the extra route when the URL matters.

**A file coming in is the same trap from the other side.** A form with an
`<input type="file">` posts `multipart/form-data`. **Read a multipart body as
bytes; decoding it as text first corrupts every binary file** - each byte of an
image that is not valid UTF-8 becomes U+FFFD, and the upload succeeds with a
200 and a broken file. Let the framework's multipart parser have it
(`IFormFile` in ASP.NET, `multer` or `busboy` in Express, `request.formData()`
on a Fetch-style server) rather than `req.body.toString()` or `data += chunk`
and a hand split on the boundary.

## Behind a host

Everything above is one server answering for itself. In a system of several
applications, a **host** - a hub, a dashboard, a native shell's server - owns
the page and proxies each application's URL space, and the work divides
differently. The `koda-composition` skill has the whole design; the server's
share of it is this:

**An application behind a host answers one shape: the fragment.** The host
always asks with `x-koda-fragment: 1`, and it is the host that decides whether
the person wanted a page and wraps the fragment in its own shell. The
application renders no layout, no navigation and no `<html>` - so it cannot
disagree with the host about what the page looks like.

**The host decides "wrap it or pass it through" from the answer's
`content-type`.** A `200 text/html` from the application is a fragment; a
stylesheet, an icon, JSON or a file goes to the browser untouched. Never decide
from the URL: that is how a host ends up answering a request for an
application's CSS with its own whole page.

**The application still sets `x-koda: 1` on its answers**, and the host passes
it through, so Koda can tell the application's `422` from the host's own
error page. The host sets `Vary`/`Cache-Control` on what it wraps, because the
two shapes are now its responses - but it **adds** its `x-koda-fragment` to
whatever `Vary` the application sent, never replacing it, or an application's
`Vary: accept` is lost and a cache in front of the host serves one
representation to everyone.

**Only an allow-list of headers crosses the proxy.** In: `content-type`,
`accept`, `accept-language`, `x-koda-request-id`, `x-koda-queued-at`, and a
bearer token the host obtained for *this* application. Out: `content-type`,
`location`, `content-disposition`, `cache-control`, `vary`, `x-koda`. Redirects travel
back as answers, not followed by the host, so the `Location` reaches the page.

**The browser's cookies never reach the application.** Session cookies are the
host's, named for the host (browsers share cookies across ports, so two hosts
on one machine with one name sign each other out). The application learns who
is asking only from a token it can verify against the identity service's
published keys - never from a header the host writes. When it cannot tell,
it answers `401` with `x-koda: 1`, and Koda keeps the region's content and the
request for a retry after signing in (see "When the application cannot tell
who is asking: 401" in the reference).

**The design system is the host's to serve, from the host's origin**
(`/ds/v1/...`), and an application's own icons arrive through the host's proxy,
so both are same origin and need no CORS. If the design system is ever served
from somewhere else - a CDN, a shared static origin - its icons and fonts need
`Access-Control-Allow-Origin` for the pages that use them. A `mask-image` is
fetched in CORS mode, and without the header the icon silently draws nothing.

**An application publishes a manifest** at a well-known path - its id, the URL
space it owns, its home, its icon, the assets worth keeping offline, the
design-system version it was built against - and that, plus its origin, is
all a host is told. The host validates it and names no application in code.

---

# ASP.NET

The mapping is direct, and pleasingly so: **a fragment is a `PartialView`, a
cold load is a `View`.**

```csharp
public IActionResult Detail(int id)
{
    var model = _orders.Get(id);
    return IsFragment ? PartialView("_Detail", model) : View("Detail", model);
}

private bool IsFragment => Request.Headers["x-koda-fragment"] == "1";
```

`Detail.cshtml` renders the layout and includes the same partial, so there is
one template for the content:

```cshtml
@model Order
<div id="workspace" ko-scope="/orders" ko-location="@Context.Request.Path" ko-history>
    <partial name="_Detail" model="Model" />
</div>
```

Put the two response headers on everything, once, in middleware:

```csharp
app.Use(async (context, next) =>
{
    context.Response.Headers.Append("Vary", "x-koda-fragment");
    context.Response.Headers.Append("x-koda", "1");
    await next();
});
```

**Output caching is configured separately from the header.** The response saying
`Vary` does not tell ASP.NET's cache anything:

```csharp
// Response caching
[ResponseCache(Duration = 60, VaryByHeader = "x-koda-fragment")]

// Output caching (.NET 7+)
builder.Services.AddOutputCache(options =>
    options.AddBasePolicy(policy => policy.SetVaryByHeader("x-koda-fragment")));
```

Antiforgery needs nothing: `@Html.AntiForgeryToken()` inside the form,
`[ValidateAntiForgeryToken]` on the action. For the header route:

```csharp
builder.Services.AddAntiforgery(options => options.HeaderName = "X-CSRF-TOKEN");
```

Refusals keep the fragment and the status:

```csharp
if (!ModelState.IsValid)
{
    Response.StatusCode = 422;
    return PartialView("_Detail", model);   // x-koda: 1 is already on it
}
```

# Express

The same shape as ASP.NET: a partial for the fragment, and a view that puts
the partial inside the layout. Here with Eta, once the person has chosen it
(see *Views are files* above); any engine with includes works the same way.

```
views/
  layout.eta             the page: head, navigation, the script tag
  orders/detail.eta      the layout around the partial, for a cold load
  orders/_detail.eta     the fragment itself
```

```js
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

const eta = new Eta({ views: fileURLToPath(new URL('./views', import.meta.url)) });

app.use((req, res, next) => {
  res.set('Vary', 'x-koda-fragment');
  res.set('x-koda', '1');
  next();
});

app.get('/orders/:id', (req, res) => {
  const fragment = req.get('x-koda-fragment') === '1';
  const model = { order: orders.get(req.params.id), path: req.path };

  res.send(eta.render(fragment ? 'orders/_detail' : 'orders/detail', model));
});

app.post('/orders/:id/notes', (req, res) => {
  addNote(req.params.id, req.body.note);
  res.redirect(303, `/orders/${req.params.id}`);
});
```

`orders/detail.eta` contains the partial rather than a copy of it:

```html
<% layout('../layout') %>
<div id="workspace" ko-scope="/orders" ko-location="<%= it.path %>" ko-history>
  <%~ include('./_detail', it) %>
</div>
```

The example servers in the Koda repository work this way: each one's handlers
are in `tools/<app>.js`, and its views are in `tools/views/<app>/`, rendered
with Eta through `tools/views.js`. `tools/delivery-app.js` and
`tools/views/delivery/` are the smallest complete example. The one exception
is the large-diff server, which builds each highlighted line in code because a
view per line was two to three times slower at 200,000 lines; it says so where
it does it.

---

# Checklist

Before calling it wired up:

- [ ] Every fragment is a view file in the project's template engine, not markup built in a handler
- [ ] Every handler that can answer a region checks `x-koda-fragment`
- [ ] The cold-load shell **contains** the fragment rather than duplicating it
- [ ] The region in the shell carries `ko-location` set to the request path
- [ ] `Vary: x-koda-fragment` on anything cacheable
- [ ] If a URL has two representations: `Vary` adds `Accept` on that response
      only, the type is matched by name, and it survives every proxy in front
- [ ] Every cache in front of the app keys on that header, or does not cache the HTML
- [ ] `x-koda: 1` on every application response, **including your own 4xx**
- [ ] Refusals return the fragment with the field marked, not a redirect to an error page
- [ ] `POST` that changes something redirects (`303`) rather than answering directly
- [ ] File responses use `ko-download` or `<a download>`, never a routed region
- [ ] Behind a host: the application answers fragments only, the host decides
      the shape from `content-type`, and no browser cookie crosses the proxy

# Verifying it

```bash
# Two shapes, one URL. The second should be a whole document.
curl -s -H 'x-koda-fragment: 1' http://localhost:3000/orders/1041 | head -3
curl -s                          http://localhost:3000/orders/1041 | head -3

# The headers that matter.
curl -sI http://localhost:3000/orders/1041 | grep -iE 'vary|x-koda'
```

Then in a browser: load a deep link cold and confirm it is a whole page; click
into a region and confirm the panel gets a fragment; press back; reload.
