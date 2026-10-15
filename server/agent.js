// The agent: the Claude Code CLI, run once per turn in the chosen folder.
//
//   runner.turn({ cwd, sessionId, resume, prompt, systemPrompt, designPath, references, onEvent })
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
// design's sessions/. Anything else is refused without asking. No MCP servers,
// no skills, and none of this machine's settings, so a broad "allow" in
// someone's user settings can't widen what the agent may read or write.

import { spawn } from 'node:child_process';

const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'];

/**
 * Reads are fenced by Claude Code itself: with no read rule of ours, it allows
 * reading the working directory and each --add-dir, and in dontAsk mode
 * refuses the rest. (A bare "Read" in --allowedTools would allow the whole
 * machine; it was there until step 5.) Reference folders must be canonical
 * paths, or a Windows short name stops them matching.
 */
export function permissionArgs(designPath, references = []) {
  const scope = `${designPath}/**`;
  const sessions = `${designPath}/sessions/**`;
  return [
    '--tools', TOOLS.join(','),
    '--allowedTools', [`Edit(${scope})`, `Write(${scope})`].join(','),
    '--disallowedTools', [`Edit(${sessions})`, `Write(${sessions})`].join(','),
    ...references.flatMap(path => ['--add-dir', path]),
    '--permission-mode', 'dontAsk',
  ];
}

export function createCliRunner({ command = 'claude', model = null } = {}) {
  return {
    turn({ cwd, sessionId, resume, prompt, systemPrompt, designPath, references = [], onEvent = () => {} }) {
      const args = [
        '-p',
        '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        ...permissionArgs(designPath, references),
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
export function designPrompt({ title, designPath, references = [], kind = 'design', format = 'screens', system = null, shell = null, kodaPath = null, stack = null }) {
  const what = { system: 'design system', shell: 'app shell' }[kind] ?? 'design';
  const parts = [`You are working in Prelude, a tool where a person designs an application with you.

You are working on the ${what} "${title}". Its folder is ${designPath}/, relative to the current directory, which is the person's repository.

- Write only inside ${designPath}/, and never inside ${designPath}/sessions/. Everything else in the repository is for reading: use it to understand the product, its domain and its existing UI.${references.length ? `
- You may also read these folders, and nothing else outside the repository: ${references.map(r => `${r.name} (${r.path})`).join(', ')}. Read them; never write to them.` : ''}
- A design is built up over many sessions, and this conversation is one of them. Its memory is its files, not past conversations. At the start of a session, read ${designPath}/NOTES.md if it exists, and look at what the design already has.
- Keep ${designPath}/NOTES.md current: what this is for, the decisions made (each with its reason), and the open questions. Update it before you finish any turn in which something was decided or learned. Keep it short, and edit it rather than appending a log.
- When a request is ambiguous or large, say briefly what you plan to do and ask before building. Keep replies short.`];

  if (format === 'views') parts.push(viewsSection({ designPath, kind, system, shell, kodaPath, stack }));
  else parts.push(`Screens are plain, static HTML files in ${designPath}/screens/, named NN-kebab-name.html (for example 01-sign-in.html), each with a short <title> that names the screen. The person watches them in a preview that reloads as you save. Link between screens with relative links. No build step, no frameworks, no requests to other sites.`);

  if (kind === 'system') {
    parts.push(`This is the folder's design system: the app's vocabulary, which every other design uses. It holds no layouts; those are the app shell's. It lives in ${designPath}/system/:

- system/tokens.css - the tokens: custom properties on :root named for their role, never their look (--bg, --surface, --surface-sunken, --border, --fg, --fg-muted, --fg-subtle, --accent, --accent-hover, --accent-fg, --accent-soft, --good, --warn, --danger, --space-1…, --radius-sm…, --text-xs…, --font-sans, --shadow-md, --ring). Write each colour once with light-dark(). Literal colours belong here and nowhere else.
- system/components.css - the components: classes built from the tokens and nothing else (no literal colours, spaces or radii), with a base section for bare elements, including [hidden] { display: none !important; }. Lay out with container queries, never @media.
- system/components/<name>.html - one file per component: its canonical markup, starting with an HTML comment that says what it is for and when to use it. This is what designs copy, so keep it exactly in step with components.css.
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
- Don't change the design system from here. If it lacks something this design needs, design around it, and note in ${designPath}/NOTES.md what the system is missing, so it can be added in a session on the system itself.`);
  } else if (format === 'screens') {
    parts.push(`Styles shared by screens go in ${designPath}/styles.css, linked from a screen as ../styles.css. This folder has no design system yet; when it gets one, its designs will use it.`);
  }
  return parts.join('\n\n');
}

/** How a design of views is made: the app's own views, a route table and fake data. */
function viewsSection({ designPath, kind, system, shell, kodaPath, stack }) {
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

Search and filter forms use GET: <form method="get" action="/orders"> with inputs named for the query parameters. Every view sees the query string as it.$query, so the form shows what was asked (value="<%= it.$query.q ?? '' %>"). The route filters, as the app's controller would, so views never filter: "search": { "q": ["borrower", "id"] } keeps the records where any of those fields contains ?q= (ignoring case); "match": { "status": "status" } keeps those whose field equals ?status=; an empty parameter filters nothing. They apply to the route's data when it is a list, or to the list at "list" inside it ("list": "orders"). For search as you type, give the results their own fragment route with the same filters and load it as a region that follows the box: <input type="search" id="q" name="q"> and <div id="results" ko-region calc-ko-source="'/orders/results?q=' + encode(q.value)" ko-invoke="input:q" ko-debounce="250">. Make sure a search that matches nothing shows a clear empty result.

One URL answers in two shapes, and Prelude does it for you, as the real server does: a request from a Koda region (a fragment request) gets the view alone; any other request gets it inside its layout. So write each view as the region's content, never a whole page, and decompose with Koda the way the real app would: ko-scope for a section that owns a URL space, ko-source for a region that loads its own URL, ko-target for an answer aimed at one region, ko-item and ko-as instead of numbered ids. Routes are root-relative, the app's real URLs.`);

  if (kodaPath) lines.push(`Before writing views, read Koda's own guidance: ${kodaPath}/.claude/skills/koda-app-authoring/SKILL.md, and the koda-styling skill beside it. Look attributes up in ${kodaPath}/docs/reference.md rather than from memory.`);

  if (kind === 'shell') {
    lines.push(`This is the app's shell: the layouts every design in the folder renders in. They live in ${designPath}/layouts/:

- layouts/<name>.eta - a whole HTML page around a design's view. It receives it.body (the rendered view, written with <%~ it.body %>), it.title, it.location (the request path), and it.layout (the shell's data: who's signed in, the navigation, counts). It links the design system's styles (/_prelude/system/tokens.css, /_prelude/system/components.css${system?.hasIcons ? ', /_prelude/system/icons.css' : ''}) and each design's own (/_prelude/design/styles.css), starts Koda (<script type="importmap">{ "imports": { "@kodalang/core": "/_prelude/koda/koda.js" } }</script> and a module script that imports start and calls start(document)), and wraps the body in the region that owns the page: <main id="main" ko-scope="/" ko-location="<%= it.location %>" ko-history><%~ it.body %></main>. It also offers the regions pages may ask for, such as a drawer and a modal. Each region prints what Prelude puts in it for a deep link to an overlay, from it.regions.<name> = { html, location }: <aside id="drawer" ko-region<% if (it.regions.drawer) { %> ko-location="<%= it.regions.drawer.location %>"<% } %>><%~ it.regions.drawer?.html ?? '' %></aside>. That is what the app's own layout must do to answer a link straight to a drawer, so keep it in every region a layout offers.
- layouts/<name>.json - sample data for that layout, which every design gets unless its state overrides it under "layout".
- "app" is the layout every design uses unless a route names another (for example "bare", for sign-in or a full-screen wizard).

The shell's own routes.json, views and states are its gallery: a page per layout, with sample content that shows each region it offers.`);
  } else {
    lines.push(shell
      ? `Pages render in the app shell's layouts (${shell.path}/layouts/), which load the design system and Koda. Don't change the shell from here; if this design needs a new kind of page, draft a layout in ${designPath}/views/layouts/<name>.eta and note in NOTES.md that it should move to the shell once agreed.`
      : `This folder has no app shell yet, so pages render in a minimal built-in layout that loads the design system (if there is one), this design's styles.css, and Koda.`);
  }
  if (kind !== 'system' && system) {
    lines.push(`Use the folder's design system, "${system.title}" (${system.path}/system/): read its guidelines.md and components/ before designing, build views from its components' markup and classes, and write no literal colours, spaces or radii. Don't change it from here; note in NOTES.md what it lacks.`);
  } else if (kind !== 'system') {
    lines.push(`This folder has no design system yet; when it gets one, its designs will use it.`);
  }
  return lines.join('\n\n');
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
