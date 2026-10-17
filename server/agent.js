// The agent: the Claude Code CLI, run once per turn in the chosen folder.
//
//   runner.turn({ cwd, sessionId, resume, prompt, systemPrompt, designPath, references, mode, onEvent })
//     -> { done: Promise<{ ok, stopped?, error?, costUsd? }>, stop() }
//
// onEvent gets a few plain events:
//
//   { type: 'init' }                          the CLI has started the conversation
//   { type: 'text-start' }                    the agent starts saying something
//   { type: 'text-delta', text }              more of it, as it's written
//   { type: 'text', text }                    all of it
//   { type: 'tool', id, name, input }         it used a tool
//   { type: 'tool-result', id, isError, text }
//
// The agent gets ordinary file tools and nothing else (plan: ground rule 3).
// It may read the folder and the folder's reference folders, and nothing else
// on the machine; it may write only inside its design's folder, never in that
// design's sessions/ and snapshots/. Anything else is refused without asking. No MCP servers,
// no skills, and none of this machine's settings, so a broad "allow" in
// someone's user settings can't widen what the agent may read or write.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { eventLine } from './backlog.js';

const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'];

/**
 * Reads are fenced by Claude Code itself: with no read rule of ours, it allows
 * reading the working directory and each --add-dir, and in dontAsk mode
 * refuses the rest. (A bare "Read" in --allowedTools would allow the whole
 * machine; it was there until step 5.) Reference folders must be canonical
 * paths, or a Windows short name stops them matching.
 */
export function permissionArgs(designPath, references = [], mode = 'design', shared = []) {
  // A design session writes its design. A build session (step 7) writes the
  // app - anything in its worktree - but not the design it builds from: its
  // views, states and approved screens are the specification. It may still
  // edit routes.json (to point routes at the app's views), RULES.md (to remove
  // a rule's *proposed* marker) and NOTES.md.
  // On its branch (step 9), a design may also change the design system and
  // the shell (`shared`), when it needs to; never their sessions or approved screens.
  const scopes = mode === 'build' ? ['**'] : [`${designPath}/**`, ...shared.map(path => `${path}/**`)];
  // Its sessions are Prelude's record, and its snapshots are what the person approved.
  const kept = [`${designPath}/sessions/**`, `${designPath}/snapshots/**`,
    ...shared.flatMap(path => [`${path}/sessions/**`, `${path}/snapshots/**`]),
    ...(mode === 'build' ? [`${designPath}/views/**`, `${designPath}/states/**`, '.git/**'] : [])];
  return [
    '--tools', TOOLS.join(','),
    '--allowedTools', scopes.flatMap(scope => [`Edit(${scope})`, `Write(${scope})`]).join(','),
    '--disallowedTools', kept.flatMap(path => [`Edit(${path})`, `Write(${path})`]).join(','),
    ...references.flatMap(path => ['--add-dir', path]),
    '--permission-mode', 'dontAsk',
  ];
}

export function createCliRunner({ command = 'claude', model = null } = {}) {
  return {
    turn({ cwd, sessionId, resume, prompt, systemPrompt, designPath, references = [], mode = 'design', shared = [], onEvent = () => {} }) {
      const args = [
        '-p',
        '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        ...permissionArgs(designPath, references, mode, shared),
        '--strict-mcp-config',
        '--setting-sources', '',
        '--disable-slash-commands',
        '--append-system-prompt', systemPrompt,
        // Otherwise a resumed conversation keeps its first system prompt for
        // ever; ours changes as Prelude does.
        '--system-prompt-snapshot', 'off',
        resume ? '--resume' : '--session-id', sessionId,
        ...(model ? ['--model', model] : []),
      ];
      const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stopped = false;
      let stderr = '';
      child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });

      const done = new Promise(resolve => {
        const read = createStreamReader(onEvent);
        let result = null;
        let buffer = '';
        child.stdout.on('data', chunk => {
          buffer += chunk;
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let message;
            try { message = JSON.parse(line); } catch { continue; }
            result = read(message) ?? result;
          }
        });
        child.on('error', error => resolve({ ok: false, error: `The agent couldn't start: ${error.message}` }));
        child.on('close', code => {
          if (stopped) return resolve({ ok: false, stopped: true });
          if (result) return resolve(result);
          const detail = stderr.trim().split('\n').slice(-3).join(' ');
          if (/no conversation found/i.test(detail)) {
            return resolve({ ok: false, error: 'This conversation can’t be resumed on this machine. Start a new session: it picks up from the design’s files.' });
          }
          resolve({ ok: false, error: `The agent stopped without finishing (exit ${code}). ${detail}`.trim() });
        });
      });

      child.stdin.end(prompt);
      return {
        done,
        stop() {
          stopped = true;
          child.kill();
        },
      };
    },
  };
}

/** Turns the CLI's stream-json messages into the events above; returns the result when it comes. */
//
// Text streams as partial messages (content_block_start / _delta / _stop) when
// the CLI sends them; the whole assistant message that follows repeats that
// text, so it's used for text only when nothing streamed.
export function createStreamReader(onEvent) {
  const blocks = new Map();   // index -> text so far, for text blocks
  let streamed = false;

  return function read(message) {
    if (message.type === 'system' && message.subtype === 'init') {
      onEvent({ type: 'init' });
      return null;
    }
    if (message.type === 'stream_event') {
      const e = message.event ?? {};
      if (e.type === 'content_block_start' && e.content_block?.type === 'text') {
        streamed = true;
        blocks.set(e.index, '');
        onEvent({ type: 'text-start' });
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && blocks.has(e.index)) {
        blocks.set(e.index, blocks.get(e.index) + e.delta.text);
        onEvent({ type: 'text-delta', text: e.delta.text });
      } else if (e.type === 'content_block_stop' && blocks.has(e.index)) {
        onEvent({ type: 'text', text: blocks.get(e.index) });
        blocks.delete(e.index);
      }
      return null;
    }
    if (message.type === 'assistant') {
      for (const part of message.message?.content ?? []) {
        if (part.type === 'text' && !streamed && part.text.trim()) onEvent({ type: 'text', text: part.text });
        if (part.type === 'tool_use') onEvent({ type: 'tool', id: part.id, name: part.name, input: part.input ?? {} });
      }
      return null;
    }
    if (message.type === 'user') {
      for (const part of message.message?.content ?? []) {
        if (part.type !== 'tool_result') continue;
        const text = Array.isArray(part.content)
          ? part.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : String(part.content ?? '');
        onEvent({ type: 'tool-result', id: part.tool_use_id, isError: part.is_error === true, text });
      }
      return null;
    }
    if (message.type === 'result') {
      const ok = message.is_error !== true && message.subtype === 'success';
      return {
        ok,
        costUsd: message.total_cost_usd ?? null,
        error: ok ? null : String(message.result || message.subtype || 'The agent reported an error.'),
      };
    }
    return null;
  };
}


// A design that uses the system composes its pages from the system's layout
// primitives, which own the space between blocks (plan, 5e).
const COMPOSE = 'Compose pages from the system\'s layout primitives and leave the space between blocks to their gaps: no margins between blocks, and no spacing values of the design\'s own. A design\'s styles.css is for what the system can\'t express. If a primitive is missing, treat it as any missing component.';

/**
 * The instructions appended to Claude Code's own system prompt for a session
 * on a design.
 *
 *   title, designPath   the design ("Sign up", "prelude/onboarding/sign-up")
 *   references          folders the agent may also read: [{ name, path }]
 *   kind                'design', 'system' (the folder's design system) or
 *                       'shell' (the app's shell: its layouts)
 *   format              'views' - the app's views, routes.json and states/,
 *                       served by Prelude's Eta host (the default); or
 *                       'screens' - plain screens/*.html (older designs, and
 *                       the design system's gallery)
 *   system              the folder's design system, if it has one and this
 *                       isn't it: { title, path, href, hasIcons } - href is
 *                       system/ relative to screens/, for plain screens
 *   shell               the folder's shell, if it has one and this isn't it:
 *                       { title, path }
 *   kodaPath            where Koda's own guidance is, for a design of views
 */
export function designPrompt({ title, designPath, references = [], kind = 'design', format = 'screens', system = null, shell = null, kodaPath = null, stack = null, shared = [] }) {
  const what = { system: 'design system', shell: 'app shell' }[kind] ?? 'design';
  const where = shared.length ? `${designPath}/ (and, when this design needs it, ${shared.map(path => `${path}/`).join(' and ')}; see below)` : `${designPath}/`;
  const parts = [`You are working in Prelude, a tool where a person designs an application with you.

You are working on the ${what} "${title}". Its folder is ${designPath}/, relative to the current directory, which is the person's repository.

- Write only inside ${where}, and never inside a design's sessions/ or snapshots/ (the screens the person approved). Everything else in the repository is for reading: use it to understand the product, its domain and its existing UI.${references.length ? `
- You may also read these folders, and nothing else outside the repository: ${references.map(r => `${r.name} (${r.path})`).join(', ')}. Read them; never write to them.` : ''}
- What you may read is set in Prelude, not in this conversation. If you need a folder outside the repository (another app's code or CSS, say) and can't read it, ask the person to add it under "What the agent can read" on this folder's page in Prelude; you can read it from their next message. Don't ask them to copy files into the repository or paste them instead.
- A design is built up over many sessions, and this conversation is one of them. Its memory is its files, not past conversations. At the start of a session, read ${designPath}/NOTES.md if it exists, and look at what the design already has.
- Keep ${designPath}/NOTES.md current: what this is for, the decisions made (each with its reason), and the open questions. Update it before you finish any turn in which something was decided or learned. Keep it short, and edit it rather than appending a log.
- When a request is ambiguous or large, say briefly what you plan to do and ask before building. Keep replies short.`];

  const mayChange = path => shared.includes(path);
  if (format === 'views') parts.push(viewsSection({ designPath, kind, system, shell, kodaPath, stack, mayChange }));
  else parts.push(`Screens are plain, static HTML files in ${designPath}/screens/, named NN-kebab-name.html (for example 01-sign-in.html), each with a short <title> that names the screen. The person watches them in a preview that reloads as you save. Link between screens with relative links. No build step, no frameworks, no requests to other sites.`);

  if (kind === 'system') {
    parts.push(`This is the folder's design system: the app's vocabulary, which every other design uses. It holds no layouts; those are the app shell's. It lives in ${designPath}/system/:

- system/tokens.css - the tokens: custom properties on :root named for their role, never their look (--bg, --surface, --surface-sunken, --border, --fg, --fg-muted, --fg-subtle, --accent, --accent-hover, --accent-fg, --accent-soft, --good, --warn, --danger, --space-1…, --radius-sm…, --text-xs…, --font-sans, --shadow-md, --ring). Write each colour once with light-dark(). Literal colours belong here and nowhere else.
- system/components.css - the components: classes built from the tokens and nothing else (no literal colours, spaces or radii), with a base section for bare elements, including [hidden] { display: none !important; }. Lay out with container queries, never @media.
- system/components/<name>.html - one file per component: its canonical markup, starting with an HTML comment that says what it is for and when to use it. This is what designs copy, so keep it exactly in step with components.css.
- Layout primitives, among the components: classes that arrange their children and own the space between them, so pages are spaced the same everywhere. Which ones, and their names, are yours to decide; common ones are a stack (one under another), a cluster (a row that wraps), a grid (equal columns, as many as fit), a split (a main part and a side part that drops below when narrow) and a center (held to a readable width). Each spaces its children with gap, taken only from the --space-* tokens (a variant per step if needed), never margins, and copes with narrow widths by wrapping or container queries, never @media. Give each its file in components/ and its place on the components screen, and say in guidelines.md how pages are composed from them. Drafted from an app that already has layout helpers, take those, under the app's names. If the system has none yet, add them.
- system/guidelines.md - the rules, each with its reason and a short do and don't, and the product's words with the words to avoid.
- system/icons/<meaning>.svg and system/icons.css, if the system has icons: one SVG per glyph, named for what it means (close, not x), drawn by masking a box filled with currentColor, with forced-color-adjust: none. Each glyph's URL is a token defined in icons.css, relative to icons.css; keep every rule that uses those tokens in icons.css, so the relative URLs resolve there.
- Every CSS file in system/ starts with the same line, @layer tokens, base, components, host; and puts its rules in those layers: tokens in tokens, bare elements in base, classes in components. Designs' own rules stay unlayered, so they win.

The screens are the system's gallery: a tokens screen, a components screen showing each component and its variants, and a guidelines screen. They link ../system/tokens.css, ../system/components.css (and ../system/icons.css), and use the system exactly as a design would. Whenever you change system/, bring the gallery up to date in the same turn.

If the person points you at existing CSS (this repository's, or a reference folder's), draft the system from what is really there: its colours, spacing, type and components, renamed by role, rather than inventing a new look.`);
  } else if (system && format === 'screens') {
    parts.push(`This folder has a design system, "${system.title}", in ${system.path}/system/. Use it:

- Before designing, read ${system.path}/system/guidelines.md and the components in ${system.path}/system/components/.
- Every screen links the system's styles, in this order, before its own: ${system.href}/tokens.css, ${system.href}/components.css${system.hasIcons ? `, ${system.href}/icons.css` : ''}. Then ../styles.css for this design's own rules, if it needs any.
- Build screens from the system's components, copying their markup and classes. Write no literal colours, spaces or radii; use the tokens.
- ${COMPOSE}
${mayChange(system.path) ? '- If the system lacks something this design needs, change it as described below.' : `- Don't change the design system from here. If it lacks something this design needs, design around it, and note in ${designPath}/NOTES.md what the system is missing, so it can be added in a session on the system itself.`}`);
  } else if (format === 'screens') {
    parts.push(`Styles shared by screens go in ${designPath}/styles.css, linked from a screen as ../styles.css. This folder has no design system yet; when it gets one, its designs will use it.`);
  }
  if (shared.length) parts.push(sharedSection({ title, designPath, system: system && mayChange(system.path) ? system : null, shell: shell && mayChange(shell.path) ? shell : null }));
  return parts.join('\n\n');
}

/**
 * Changing a shared design from a feature's branch (plan: step 9): the design
 * system or the shell, when the feature needs it. The change travels with the
 * feature and is reviewed with it.
 */
function sharedSection({ title, designPath, system, shell }) {
  const which = [system && `the design system (${system.path}/)`, shell && `the app shell (${shell.path}/)`].filter(Boolean).join(' and ');
  const show = [
    system && `add or update the component's file in ${system.path}/system/components/, the guidelines in ${system.path}/system/guidelines.md if the change brings a rule, and the system's gallery screens`,
    shell && `the shell's gallery (${shell.path}/routes.json, its views and states) for a layout or region`,
  ].filter(Boolean).join('; ');
  const notes = [system && `${system.path}/NOTES.md`, shell && `${shell.path}/NOTES.md`].filter(Boolean).join(' or ');
  return `This design works on a branch of its own, and may change ${which} when it needs to: a token, a component or a variant of one, a navigation item, a region or a layout. The change travels with this design and is reviewed with it, so make it the way their owners would:

- Keep it general: something any design could use, not shaped for this one.
- Show it where their owners look: ${show}.
- Add a line to ${notes} saying what changed and that "${title}" (${designPath}) needed it.
- Change nothing else there, and never another design.`;
}

/** How a design of views is made: the app's own views, a route table and fake data. */
function viewsSection({ designPath, kind, system, shell, kodaPath, stack, mayChange = () => false }) {
  const lines = [];
  // Another stack: its views are its own template language, rendered by the
  // repository's design host; its guide says how they're written.
  if (stack) {
    lines.push(`This repository's app isn't written in Eta. Its views are its own templates, files ending ${stack.ext}, rendered by the repository's design host with the app's real components and helpers. Wherever these instructions show Eta, write the same thing in ${stack.ext} instead.${stack.guide ? ` Read ${stack.guide} before writing any view: it says how views, partials, layouts and form fields are written here, and how a view reads its model, the query ($query) and a refused form's messages ($errors).` : ''} Name views with that extension (views/orders/list${stack.ext}); routes name them without it, as before.`);
  }
  lines.push(`This design is the app's views, decomposed the way the app decomposes them, and Prelude serves it the way the app's server would, with Koda running for real. It is made of:

- ${designPath}/views/ - Eta views (<%= value %> escapes, <%~ html %> doesn't, <% code %> runs). include() renders a partial, and its path is relative to the including view's own folder, as in any Eta app: from views/orders/list.eta, include('./_row', row) renders views/orders/_row.eta; a path starting with / is from views/, as in include('/orders/_row', row). Eta copies a partial's data into a plain object, so pass partials objects (include('./_results', { orders }) or it), never a bare list, and give a fragment's own route the same shape (a data path to the object, with "list" for the list it filters). A page is a view a route renders; a fragment is a view named with a leading underscore (orders/_row.eta) that pages include and that also answers alone at a route of its own, so a region can load or replace it.
- ${designPath}/routes.json - the URLs the design answers, as the app's router would: { "/orders": { "view": "orders/list", "title": "Orders", "data": "" }, "/orders/:id": { "view": "orders/detail", "title": "Order", "data": "orders/:id" }, "/orders/:id/row": { "view": "orders/_row", "data": "orders/:id" } }. "data" is a path into the state's dataset: a property, or, in a list, the record whose id matches the route's :param; "" is the whole dataset. The view receives what it finds as it. A route with a title, and no :params, is a page the person can pick in the preview. "layout" names the layout (default "app").
- ${designPath}/states/NN-name.json - fake data for the whole design, one dataset per state: 01-typical.json first (the default), then states such as 02-empty.json or 03-long-names.json. Every route reads from the state on show, so the list, the detail and every fragment agree. Make the data realistic: real-looking names, amounts and dates, lists of a believable length. Put conditions in the views (an empty list shows the empty state because the view says so), never flags in the data.
- ${designPath}/styles.css - this design's own rules, if it needs any, unlayered. Pages get it at /_prelude/design/styles.css.

Drawers, modals and side panels are overlays: a fragment presented in a region the layout offers, over the page the person was on. Give an overlay a route of its own with "over" (the page beneath, using the overlay's :params) and "in" (the region): "/orders/:id/edit": { "view": "orders/_edit", "title": "Edit order", "data": "orders/:id", "over": "/orders/:id", "in": "drawer" }. Open it from the page with a link to its URL and ko-target="drawer?" (or "modal?"). Prelude shows it in the preview over a real page beneath, as the app's server should answer a deep link to it.

Forms post to POST routes in the same routes.json, keyed "POST <url>". Each does one thing to the state's data at a path, the same paths GET routes use: "update" merges the posted fields into that record (a field keeps the type its value has; dotted names such as address.city reach inside; give a checkbox a hidden input with value "false" before it, so unchecking it is posted), "add" appends a record with the fields and a new id (the answer can use :new), "remove" takes the record out. "require" lists fields that may not be empty: an empty one is refused with a 422 that re-renders "form" with what was typed, the messages in it.$errors (mark the field with ko-invalid-server="<%= it.$errors?.name %>" when there is one, and show the message), and nothing changes. "answer" is what comes back after the change: { "redirect": "/orders/:id" } for a 303 to a page; or { "view": "orders/_row", "data": "orders/:id" } for a fragment, rendered from the changed data, landing wherever the form aimed it; plus "also": [{ "into": "summary", "view": "orders/_summary", "data": "" }] to refresh other regions out of band, and { "into": "drawer?" } alone to close the region the form was in; "event" raises a named event. For example: "POST /orders/:id": { "update": "orders/:id", "require": ["borrower"], "form": "orders/_edit", "answer": { "view": "orders/_row", "data": "orders/:id", "also": [{ "into": "drawer?" }] } }. Aim each form as the real app would: a drawer's form at the row it changes, with the drawer closed by the answer; a row that saves itself with ko-target="self" and ko-attach="replace". Changes go to a working copy of the state, never the files; the person can reset it.

A route whose view is "@app/<path>" has been ported: its view is now the app's own file in the repository (such as "@app/views/orders/list"), and the design's states are that view's test fixtures. Read it to see what the page really is, and never edit the app's file itself. Keep the states valid for it: the same shape, and every field it reads. A form's "require" names what the app's form posts. A change to a built page's data or rules needs nothing more. When its markup must change (a redesign), bring the view back into the design first: copy the app's file to ${designPath}/views/ (with the partials it includes, if they change too), point the route's "view" at the copy, and add "from": "@app/<the path it came from>" to the route. Then redesign the copy as any design view. The page shows as to build again, and its build ports your version back over the app's file.

When the server tells a page something unprompted (a count that changes, a notice, a row someone else added), declare it in ${designPath}/events.json, keyed by the event's name: { "needs-changed": { "title": "A pull request needs review", "add": "needs", "with": { "summary": "Landing Page is ready to merge" }, "send": "needs-changed", "push": [{ "into": "notice?", "view": "home/_notice", "data": "needs/:new" }] } }. "title" is what the person picks it by. A change to the state's data is optional: "update", "add" or "remove" at a data path, as a POST route does, with "with" giving the fields (":new" is an added record's id). Then "send" sends an event in Koda's message format ("name" or "name:value"), which a region with ko-invoke="event:needs-changed" reloads on, and "push" sends markup rendered from the views, each envelope into a region (with ? when the page may not have it); one of them at least. The page opens the channel with <div hidden ko-connect="<%= it.layout.live %>"></div> in its layout, written only when it.layout.live is set: Prelude sets it in the preview, and the app gives its own. The person sends events from the design bar and watches the page change, and the build sends them from where they happen in the app.

Search and filter forms use GET: <form method="get" action="/orders"> with inputs named for the query parameters. Every view sees the query string as it.$query, so the form shows what was asked (value="<%= it.$query.q ?? '' %>"). The route filters, as the app's controller would, so views never filter: "search": { "q": ["borrower", "id"] } keeps the records where any of those fields contains ?q= (ignoring case); "match": { "status": "status" } keeps those whose field equals ?status=; an empty parameter filters nothing. They apply to the route's data when it is a list, or to the list at "list" inside it ("list": "orders"). For search as you type, give the results their own fragment route with the same filters and load it as a region that follows the box: <input type="search" id="q" name="q"> and <div id="results" ko-region calc-ko-source="'/orders/results?q=' + encode(q.value)" ko-invoke="input:q" ko-debounce="250">. Make sure a search that matches nothing shows a clear empty result.

One URL answers in two shapes, and Prelude does it for you, as the real server does: a request from a Koda region (a fragment request) gets the view alone; any other request gets it inside its layout. So write each view as the region's content, never a whole page, and decompose with Koda the way the real app would: ko-scope for a section that owns a URL space, ko-source for a region that loads its own URL, ko-target for an answer aimed at one region, ko-item and ko-as instead of numbered ids. Routes are root-relative, the app's real URLs.`);

  if (kodaPath) lines.push(`Before writing views, read Koda's own guidance: ${kodaPath}/.claude/skills/koda-app-authoring/SKILL.md, and the koda-styling skill beside it. Look attributes up in ${kodaPath}/docs/reference.md rather than from memory.`);

  if (kind === 'shell') {
    lines.push(`This is the app's shell: the layouts every design in the folder renders in. They live in ${designPath}/layouts/:

- layouts/<name>.eta - a whole HTML page around a design's view. It receives it.body (the rendered view, written with <%~ it.body %>), it.title, it.location (the request path), and it.layout (the shell's data: who's signed in, the navigation, counts). It links the design system's styles (/_prelude/system/tokens.css, /_prelude/system/components.css${system?.hasIcons ? ', /_prelude/system/icons.css' : ''}) and each design's own (/_prelude/design/styles.css), starts Koda (<script type="importmap">{ "imports": { "@kodalang/core": "/_prelude/koda/koda.js" } }</script> and a module script that imports start and calls start(document)), and wraps the body in the region that owns the page: <main id="main" ko-scope="/" ko-location="<%= it.location %>" ko-history><%~ it.body %></main>. It also offers the regions pages may ask for, such as a drawer and a modal. Each region prints what Prelude puts in it for a deep link to an overlay, from it.regions.<name> = { html, location }: <aside id="drawer" ko-region<% if (it.regions.drawer) { %> ko-location="<%= it.regions.drawer.location %>"<% } %>><%~ it.regions.drawer?.html ?? '' %></aside>. That is what the app's own layout must do to answer a link straight to a drawer, so keep it in every region a layout offers.
- layouts/<name>.json - sample data for that layout, which every design gets unless its state overrides it under "layout".
- "app" is the layout every design uses unless a route names another (for example "bare", for sign-in or a full-screen wizard).
- Every layout opens the server's channel when it has one: <% if (it.layout.live) { %><div hidden ko-connect="<%= it.layout.live %>"></div><% } %>. Prelude sets it.layout.live in the preview for a design with server events, and the app gives its own address.

The shell's own routes.json, views and states are its gallery: a page per layout, showing each region it offers. Make it plain which part is the layout and which isn't:

- The layout's own parts (the navigation, the header, the user menu, anything a layout draws) are real, rendered from the layout's sample data as they will be in the app.
- What a design will put in a region (the page in main, an overlay in the drawer or modal) is skeleton content: grey bars and blocks in the shape of a typical page (a heading bar, a few lines of text, a card or two), never realistic words or data, with a small muted label naming the region and what goes there ("main · a design's page"). Style it in ${designPath}/styles.css (a skeleton class from the tokens, such as --surface-sunken and --radius-sm), so it never reaches the app or the design system.
- To show how a region behaves (a page longer than the window, a wide table), add a gallery page that says so in its title ("App layout · long page"), still in skeleton.

Keep the gallery's views in ${designPath}/views/gallery/. A page the shell itself owns, one that belongs to no feature (Settings, say, or an account page the navigation links to), goes in views/ outside gallery/, with routes like any design's: it's built into the app like a feature's pages, and the gallery never is.`);
  } else {
    lines.push(shell
      ? `Pages render in the app shell's layouts (${shell.path}/layouts/), which load the design system and Koda. ${mayChange(shell.path) ? 'If this design needs something of the shell (a navigation item, a region, a new kind of page), change it as described below.' : `Don't change the shell from here; if this design needs a new kind of page, draft a layout in ${designPath}/views/layouts/<name>.eta and note in NOTES.md that it should move to the shell once agreed.`}`
      : `This folder has no app shell yet, so pages render in a minimal built-in layout that loads the design system (if there is one), this design's styles.css, and Koda.`);
  }
  if (kind === 'design') lines.push(rulesSection(designPath));
  if (kind !== 'system' && system) {
    lines.push(`Use the folder's design system, "${system.title}" (${system.path}/system/): read its guidelines.md and components/ before designing, build views from its components' markup and classes, and write no literal colours, spaces or radii. ${COMPOSE} ${mayChange(system.path) ? 'If it lacks something this design needs, change it as described below.' : 'Don’t change it from here; note in NOTES.md what it lacks.'}`);
  } else if (kind !== 'system') {
    lines.push(`This folder has no design system yet; when it gets one, its designs will use it.`);
  }
  return lines.join('\n\n');
}

// What an app build is told about the design-host contract: the contract as
// hosts.js states it, and the reference host, which a Node app can follow
// almost as it is. Read from Prelude's own files, so they never drift.
const hostContract = () => {
  const text = readFileSync(new URL('./hosts.js', import.meta.url), 'utf8');
  return text.slice(0, text.indexOf('\nimport ')).split('\n').map(line => line.replace(/^\/\/ ?/, '')).join('\n').trim();
};
const referenceHost = () => readFileSync(new URL('../tools/reference-host.js', import.meta.url), 'utf8');

/**
 * The instructions for connecting an app the project already has (plan, 8b):
 * find it and change as little as possible, so designs render as its own views
 * and features are built into it. Arguments as appBuildPrompt's.
 */
export function connectAppPrompt({ shell, designs, system = null, branch, references = [], kodaPath = null }) {
  const shellPath = `prelude/${shell.id}`;
  const list = designs.filter(design => design.kind === 'design').map(design => `  - ${design.title} (prelude/${design.id})`).join('\n') || '  (none yet)';
  return `You are connecting the app this repository already has to its designs (prelude/). Don't build an app: it exists. Find it, and change as little of it as you can. You are working in a git worktree on the branch ${branch}; Prelude commits your work to it after each turn, and the person reviews it.

The designs:
- The app's shell, ${shellPath}: its layouts are in ${shellPath}/layouts/ (each <name>.eta, with sample data in <name>.json), and its routes, views and states are their gallery.${system ? `\n- The design system, ${system.path}/system/.` : ''}
- The feature designs, each built into the app later as stories of their own:
${list}

Connect it:
1. **Find the app:** read the repository (its README, package or project files, server code and views) and work out where the app is, what it's written in, and where its views and layouts live. If there's more than one candidate, or none, stop and ask the person.
2. **prelude/prelude.json**: keep everything there, and set "app.path" to the app's folder (relative to the repository, such as "server" or "src/App") and "app.stack" to a short description of its stack from the code (for example "Node, node:http, Eta and Koda"). Keep "app.existing": true.
3. **The shell's layouts, linked only where they are the app's own.** Linking a layout in ${shellPath}/layouts.json ({ "app": "@app/<path to the app's layout, without its extension>" }) makes every design render in the app's file instead, and Prelude removes the shell's copy. So link a layout only when the shell's is the app's layout as it is (drawn from it, with the same regions and chrome). Where the shell's layout is a redesign (other regions, other chrome, a new bar), don't link it: the shell's design is what designs render in until that redesign is built into the app, and linking would throw it away. Say in ${shellPath}/NOTES.md which layouts you linked, which you left as the shell's and why.
4. **A design host, only if it's needed.** Prelude renders a design's views itself when they're Eta: the design's own, and the app's own files named "@app/<path>", with Eta's own include and layout and nothing else. If the app's views are Eta and render like that (no helpers, filters or globals of the app's own), add no host. Then name, in prelude/prelude.json's "app.assets", the URLs the app serves its own files at, by the folder each comes from, so the pages Prelude renders from the app's views load them at the same paths: { "/static/": "server/public/", "/koda/": "node_modules/@kodalang/core/src/" } (each a URL prefix ending in /, each folder inside the repository). Read them from the app's server code; Prelude's own preview paths start with /_prelude/, so never use that. If they aren't Eta, or need the app's own helpers to render, give the app Prelude's design-host contract (below), answering only when it's started with PRELUDE_HOST=1 and rendering with the app's own engine and helpers; add "host" to prelude/prelude.json ({ "start": the command that starts the app, run with PRELUDE_HOST=1 already set; "url": a localhost address of its own; "views": the views' extension; "guide": "prelude/HOST.md" }), and write prelude/HOST.md on how views, partials, layouts and form fields are written in this app. Touch nothing else in the app to do it.
5. **Change nothing else in the app**: not its pages, styles, data or tests. Where the designs and the app disagree (the app's CSS against the design system, a layout's regions, the stack the person was told), note it in ${shellPath}/NOTES.md for the person, rather than changing either.

You can't run commands. After each turn Prelude renders the shell's gallery through the connected app and tells you with the next message what fails${kodaPath ? `. Koda's server conventions, if you need them, are in ${kodaPath}/.claude/skills/koda-server-setup/SKILL.md` : ''}.

Prelude's design-host contract, if the app needs one:

${hostContract()}${references.length ? `\n\nYou may also read: ${references.map(reference => reference.path).join(', ')}.` : ''}`;
}

/**
 * The instructions for the app build (plan: step 8): create the app itself in
 * a repository that has only its designs, as its own design host, with the
 * shell's layouts ported and the design system served. `shell` is the design
 * whose session this is; `designs` the folder's designs; `system` as
 * designPrompt takes it.
 */
export function appBuildPrompt({ stack, shell, designs, system = null, branch, references = [], kodaPath = null, kodaVersion = null }) {
  const isDefault = stack === 'Node, Express, Eta and Koda';
  const shellPath = `prelude/${shell.id}`;
  const list = designs.filter(design => design.kind === 'design').map(design => `  - ${design.title} (prelude/${design.id})`).join('\n') || '  (none yet)';
  return `You are building the app itself: this repository has its designs (prelude/) but no app yet. You are working in a git worktree on the branch ${branch}; Prelude commits your work to it after each turn, and the person reviews it and opens the pull request.

The app's stack is ${stack}${isDefault ? ': a Node server using Express, rendering Eta views, with Koda in the browser' : ''}. The designs are the specification:
- The app's shell, ${shellPath}: its layouts are in ${shellPath}/layouts/ (each <name>.eta, with sample data in <name>.json), and its routes, views and states are their gallery.${system ? `\n- The design system, ${system.path}/system/: tokens.css, components.css${system.hasIcons ? ', icons.css' : ''}, and its guidelines.` : ''}
- The feature designs, each built later as stories of their own:
${list}

Build the foundation, and nothing else:
1. **The app**, in its own folder (app/ unless the stack has a convention), following the stack's conventions, with a README saying how to run it. ${isDefault ? `A package.json (Express, Eta, and @kodalang/core${kodaVersion ? ` ${kodaVersion}, the version the designs use` : ''}), and a server that answers each URL in Koda's two shapes: a request with the header x-koda-fragment: 1 gets the view alone, any other the view inside its layout; every answer sets x-koda: 1 and Vary: x-koda-fragment; a refused form answers 422 with the form. Read ${kodaPath ? `${kodaPath}/.claude/skills/koda-server-setup/SKILL.md` : 'the koda-server-setup skill'} first and follow it. Views live in app/views as Eta, rendered with autoEscape on.` : `Follow ${stack}'s usual project layout, and Koda's server conventions${kodaPath ? ` (${kodaPath}/.claude/skills/koda-server-setup/SKILL.md)` : ''}: one URL in two shapes, x-koda-fragment, x-koda: 1, Vary, 422 for a refused form.`}
2. **The app is its own design host.** Started with the environment variable PRELUDE_HOST=1, it also answers Prelude's contract, below, rendering views with the same engine, the same helpers and the same views folder as its own pages, so a design renders exactly as the app will. Any other GET serves the app's own static files, so the design system and Koda load from the app's real URLs.${isDefault ? ' The reference host below is that contract in Node, rendering Eta: build the same into the app, sharing its Eta setup.' : ' The reference host below is that contract in Node, to translate.'}
3. **prelude/prelude.json**: keep "app.stack", set "app.path" to the app's folder, and add "host": { "start": the command that ${isDefault ? 'installs the dependencies and starts the app (for example "npm install --no-audit --no-fund && node app/server.js")' : 'builds and starts the app'}, run in the repository with PRELUDE_HOST=1 already set; "url": the address it listens on, a localhost port of its own such as http://localhost:5300; "views": ${isDefault ? '".eta"' : 'the views\' extension'}; "guide": "prelude/HOST.md" }. Write prelude/HOST.md: how views, partials, layouts and form fields are written in this app, for the agents that design and build here.
4. **The design system, served:** the app serves ${system ? `${system.path}/system/` : 'the design system\'s folder (prelude/<system>/system/), once there is one,'} at its own URL (such as /system/), from that folder, not a copy.
5. **The shell's layouts, ported:** move each layout in ${shellPath}/layouts/ into the app's views (such as app/views/layouts/app.eta), element for element, changing only its links to the app's real URLs (the design system, Koda). It keeps printing what Prelude gives a layout (it.body, it.title, it.location, it.layout, it.regions). Then write ${shellPath}/layouts.json naming each: { "app": "@app/app/views/layouts/app" } (the path without its extension). Every design then renders in the app's real layout, and Prelude removes the shell's copy. If the shell has no layouts, write the app's layout from Koda's conventions: the design system's stylesheets, Koda started, and <main id="main" ko-scope="/" ko-location="<%= it.location %>" ko-history> around the page.
6. **A place for data:** one data module per area, starting as an in-memory store seeded with the designs' typical state (copied into the app; the app never reads prelude/ for data). The feature pages themselves are built later, one story at a time.

Don't add tests, CI, authentication, a database or anything else not listed: say in ${shellPath}/NOTES.md what you'd suggest next, and the person decides.

You can't run commands. After each turn Prelude starts the app as its design host (running its "start" command, which installs what it needs), renders the shell's gallery through it, and tells you with the next message what fails. The first time, the person has to approve the host in the design bar, so the first check may wait for them.

Prelude's design-host contract:

${hostContract()}

The reference host (tools/reference-host.js in Prelude):

${referenceHost()}${references.length ? `\n\nYou may also read: ${references.map(reference => reference.path).join(', ')}.` : ''}`;
}

/**
 * The instructions for a build session (plan: step 7): implement one group of
 * a design - a page, its overlays, fragments and forms - in the app's real
 * code, on a branch of its own. `group` is a backlog group (backlog.js).
 */
export function buildPrompt({ title, designPath, group, change = null, designWide = [], designEvents = [], branch, references = [], stack = null, kodaPath = null }) {
  const views = route => (route.ported ? `already the app's own: ${route.view.slice(5)}` : `${designPath}/views/${route.view}${route.from ? `, redesigned from ${route.from.slice(5)}: port it back over that file, and remove the route's "from"` : ''}`);
  const describe = route => `  - ${route.pattern}${route.title ? ` (${route.title})` : ''}${route.over ? `, an overlay in "${route.in}" over ${route.over}` : ''}: ${views(route)}`;
  const describePost = post => `  - POST ${post.pattern}: ${post.verb} ${post.at}${post.require.length ? `, requiring ${post.require.join(', ')}` : ''}`;
  // A change to a built page (step 10): only the increment, never the rest of the page.
  const routes = change
    ? [
      ...change.newRoutes.map(route => `${describe(route)} (new)`),
      ...change.changedRoutes.map(({ route, what }) => `${describe(route)} (changed: ${what.join('; ')})`),
      ...change.shape.map(({ pattern, gained, lost }) => `  - ${pattern}'s data ${[gained.length && `gains ${gained.join(', ')}`, lost.length && `loses ${lost.join(', ')}`].filter(Boolean).join(' and ')}: change the model and what fills it`),
      ...change.screens.map(screen => `  - ${screen.page} looks different in ${screen.states.join(', ')}: match its approved screens`),
      ...change.removedRoutes.map(route => `  - ${route.pattern} goes: remove it from the app`),
    ].join('\n')
    : group.routes.map(describe).join('\n');
  const posts = change
    ? [
      ...change.newPosts.map(post => `${describePost(post)} (new)`),
      ...change.changedPosts.map(({ post, what }) => `${describePost(post)} (changed: ${what.join('; ')})`),
      ...change.removedPosts.map(post => `  - POST ${post.pattern} goes: remove it from the app`),
    ].join('\n')
    : group.posts.map(describePost).join('\n');
  const rules = (change ? [...change.rules.added, ...change.rules.reworded].filter(rule => rule.proposed) : group.rules.filter(rule => rule.proposed)).map(rule => `  - ${rule.id}: ${rule.text}`).join('\n');
  const wide = designWide.filter(rule => rule.proposed).map(rule => `  - ${rule.id}: ${rule.text}`).join('\n');
  const designAt = view => (view.startsWith('@app/') ? view.slice(5) : `${designPath}/views/${view}`);
  // A change sends only its new and changed events, and stops sending the gone ones.
  const events = (change
    ? [
      ...(change.events?.added ?? []).map(event => `  - ${eventLine(event, designAt)} (new)`),
      ...(change.events?.changed ?? []).map(({ event, what }) => `  - ${eventLine(event, designAt)} (changed: ${what.join('; ')})`),
      ...(change.events?.removed ?? []).map(event => `  - ${event.name} (${event.title}) goes: stop sending it`),
    ]
    : [...(group.events ?? []), ...designEvents].map(event => `  - ${eventLine(event, designAt)}`)).join('\n');
  return `You are building part of a design into this repository's app: "${group.title}" of the design "${title}", in ${designPath}/. You are working in a git worktree on the branch ${branch}; Prelude commits your work to it after each turn, and the person reviews it and opens the pull request.

The design is the specification, and it is already the app's views: ${designPath}/routes.json says what each URL shows (its view, and "data", the path into a state that becomes the view's model) and what each form does (POST routes: update, add or remove at a data path; "require", refused with a 422 that re-renders "form" with the messages; "answer", what comes back). ${designPath}/states/ are the cases, and become the tests' fixtures. ${designPath}/RULES.md says what else must be true, and ${designPath}/NOTES.md why, including any porting spec.${stack?.guide ? ` Read ${stack.guide}: it says how views are written here, and how ported views differ.` : ''}${kodaPath ? ` The app uses Koda: look attributes up in ${kodaPath}/docs/reference.md.` : ''}

${change ? `"${group.title}" is already built: this session builds a change to it, and only that. Everything not listed stays as it is.\n\nThe change:` : 'This session builds:'}
${routes || '  (no pages)'}${posts ? `\n${posts}` : ''}${rules ? `\nand makes these proposed rules true:\n${rules}` : ''}${wide ? `\nThese proposed rules aren't tied to a page. Make true the ones what you build touches, and leave the rest:\n${wide}` : ''}${events ? `\nand has the server send these events on its own (${designPath}/events.json):\n${events}` : ''}

For each of them:
- Port the view into the app, where the app keeps its views, following its conventions: the markup stays as designed, element for element. Change only what real code requires: a typed model instead of the untyped one, the stack's real field helpers instead of design stand-ins (as ${stack?.guide ?? 'the guide'} says), real URLs. Move a design view's partials with it, and the design's styles into the app's stylesheets.
- Write the model from the states' shape, so every state still fits it, and the handler or controller that answers each route as routes.json says: the model from the app's data, a fragment for a fragment request and the page in its layout otherwise, an overlay's cold load with the page beneath, and each form exactly as its POST route says, refusal included.
- Point the route at the app's view in routes.json: its "view" (and a POST route's "form" and answer views) becomes "@app/" and the view's path from the repository's root, without its extension: a view at app/views/orders/list${stack?.ext ?? '.eta'} is "@app/app/views/orders/list".
- Make each proposed rule true, then remove its *proposed* line from RULES.md. Change nothing else in RULES.md.${events ? `
- Send each server event from where it happens in the app (the code that makes that change), over the app's live channel: server-sent events at an address the app gives its layouts as it.layout.live, which they open with ko-connect. An event is Koda's message format ("name" or "name:value"); markup is the event's push views, rendered and wrapped in ko-into envelopes. If the app has no channel yet, add one, as small as it can be.` : ''}

Never change the design's views, states, approved screens (${designPath}/snapshots/) or sessions; Prelude refuses those writes. If the design is wrong, incomplete or can't be built as it is, don't redesign it: say what and why in ${designPath}/NOTES.md, build the rest, and tell the person.

You can't run commands. After each turn Prelude renders every route of the design in every state through the app's own views, which builds the app, and tells you with the next message what fails, a state that no longer fits a model included. It also shows the person how each page differs from its approved screen. When the group is built, say what you changed, and what the person should look at before approving the screens and opening the pull request.${references.length ? `\n\nYou may also read: ${references.map(reference => reference.path).join(', ')}.` : ''}`;
}

/** How a design's RULES.md is written (plan: step 7). */
function rulesSection(designPath) {
  return `${designPath}/RULES.md holds the design's rules: behaviour worth stating as a rule, in one plain present-tense sentence about what a person observes, with no code names. The views, routes and states already say most of what the design does, so a rule is for what they leave open: that something seen in a state is intended and general, not an accident of the data (what a person without a permission sees, a limit, an ordering), and what nothing on screen can show (an email sent, a record locked). Don't restate what a view or a form's "require" already says plainly.

# Rules: <design title>

- **R-k3f.** Only an underwriter sees Edit on a funded loan's borrower.
  *shown-on: /borrowers/:id/edit @ underwriter*
  *proposed*
- **R-q8m.** Changing a borrower's email sends them a confirmation.
  *proposed*

Give each rule an id of R- and three random lowercase letters and digits, never a sequence, so two branches never both add the same one. "shown-on" names where to see it: a route of this design as routes.json writes it, and optionally "@ <state>"; leave it out when nothing on screen shows the rule. Write every new rule as *proposed*: it isn't built until the app's code makes it true, and whoever builds it removes the marker. Never renumber or delete a rule: to change one that's no longer proposed, strike it through (~~**R-2wd.** ...~~), add *retired: <why>* under it, and add a new rule. Prelude tells you when a shown-on names a route or state that doesn't exist.`;
}

/** A one-line description of a tool use, with paths shown relative to the folder. */
export function toolSummary(name, input, cwd) {
  const rel = path => {
    const p = String(path ?? '').replace(/\\/g, '/');
    const base = String(cwd).replace(/\\/g, '/').replace(/\/?$/, '/');
    return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : p;
  };
  if (input.file_path) return rel(input.file_path);
  if (name === 'Glob' || name === 'Grep') return [input.pattern, input.path && `in ${rel(input.path)}`].filter(Boolean).join(' ');
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}
