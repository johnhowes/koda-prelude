// Prelude's server: plain node:http, a handful of routes, views in Eta.
//
// Koda's contract (koda-server-setup): read x-koda-fragment, answer one URL in
// two shapes, and put `Vary: x-koda-fragment` and `x-koda: 1` on every
// response the application produces, including its own refusals.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCliRunner } from './agent.js';
import { PRELUDE_DIR, createDesign, findDesign, findShell, findSystem, groupByArea, listDesigns } from './designs.js';
import { checkDesign, datasetOf, designHostOf, designOrigin, handleDesignHost, isHosted, listStates, matchRoute, pickable, readRoutes } from './host.js';
import { createHosts, readHostConfig } from './hosts.js';
import { createRenderers } from './renderers.js';
import { canonical, cleanPath, createFolders, createReferences, refuseFolder } from './folders.js';
import { createDesignState, designChannel } from './design-state.js';
import { createLive } from './live.js';
import { createWatches, listScreens, servePreludeFile } from './preview.js';
import { createSession, listSessions, readEntries, readSession, titleFrom } from './sessions.js';
import { createTurns, designKey, sessionKey } from './turns.js';
import { presentEntry, render, shaped } from './views.js';

const here = dirname(fileURLToPath(import.meta.url));
const kodaDir = dirname(fileURLToPath(import.meta.resolve('@kodalang/core')));
// The Koda package itself (its docs and skills), canonical so the agent's
// --add-dir matches the paths its tools use.
const kodaPackage = canonical(dirname(kodaDir));

const STATIC = [
  { prefix: '/koda/', dir: kodaDir },
  { prefix: '/ds/', dir: join(here, 'public', 'ds') },
  { prefix: '/static/', dir: join(here, 'public') },
];

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

export function defaultHome() {
  return process.env.PRELUDE_HOME ?? join(homedir(), '.prelude');
}

export function createServer({ home = defaultHome(), runner = createCliRunner() } = {}) {
  const live = createLive();
  const app = {
    folders: createFolders(home),
    references: createReferences(home),
    live,
    turns: createTurns({ runner, live }),
    watches: createWatches(),
    renderers: createRenderers({ appRoot: dirname(here) }),
    hosts: createHosts({ home }),
    designs: createDesignState({ live }),
  };

  const server = createHttpServer(async (req, res) => {
    try {
      await handle(req, res, app);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.', 'text/plain; charset=utf-8');
      else res.end();
    }
  });
  // Renderer processes would outlive the server; stop them with it.
  server.on('close', () => { app.renderers.closeAll(); app.hosts.closeAll(); });
  return server;
}

async function handle(req, res, app) {
  const { folders } = app;
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  const fragment = req.headers['x-koda-fragment'] === '1';
  const page = (status, view, data, title) =>
    send(res, status, shaped(view, data, { fragment, path, title }));
  const notFoundText = () => send(res, 404, 'Not found', 'text/plain; charset=utf-8');

  // The preview origin serves the designs' files and nothing else. Screens are
  // written by the agent; on an origin of their own they can't read Prelude's
  // pages, and the check below refuses anything they post.
  //
  // It serves the folder's whole prelude/ directory at /f/<folder>/p/<path>,
  // so its URLs mirror the folders: a screen's relative link to another
  // design (the folder's design system, say) resolves the same here as on any
  // static host the folder is shared on.
  // A design's own origin: the Eta host (host.js).
  const designHost = designHostOf(req);
  if (designHost) {
    return handleDesignHost(req, res, { folders, designs: app.designs, renderers: app.renderers, hosts: app.hosts, kodaDir, designKey }, designHost);
  }

  if (isPreviewHost(req)) {
    const match = req.method === 'GET' && path.match(/^\/f\/([0-9a-f]+)\/p\/(.+)$/);
    const folder = match && folders.get(match[1]);
    if (!folder) return notFoundText();
    const rel = match[2];
    // A screen loading in a frame is the screen on show: when someone follows a
    // link inside a screen, every window follows it. A screen opened in a tab
    // of its own (sec-fetch-dest: document) changes nothing.
    const found = req.headers['sec-fetch-dest'] === 'iframe' && findDesign(folder.path, rel.split('/'));
    const screen = found && found.rest.length === 2 && found.rest[0] === 'screens' && found.rest[1].match(/^(.+)\.html$/i);
    if (screen && existsSync(join(found.dir, 'screens', found.rest[1]))) {
      app.designs.show(designKey(folder, found.design), screen[1], { shown: listScreens(found.dir)[0]?.id });
    }
    return servePreludeFile(res, join(folder.path, PRELUDE_DIR), rel, notFoundText);
  }

  // Only Prelude's own pages may change anything: not a screen on the preview
  // origin, and not some other site the person happens to have open.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return send(res, 403, 'Refused: this request came from another site.', 'text/plain; charset=utf-8');
  }

  if (req.method === 'GET') {
    for (const { prefix, dir } of STATIC) {
      if (path.startsWith(prefix)) return serveFile(res, dir, path.slice(prefix.length));
    }
  }

  // Home: open a folder, or pick a recent one.
  if (path === '/' && req.method === 'GET') {
    return page(200, 'home', { recent: folders.recent(), value: '', error: null }, 'Prelude');
  }

  if (path === '/folders' && req.method === 'POST') {
    const form = await readForm(req);
    const value = cleanPath(form.get('path'));
    const error = refuseFolder(value);
    if (error) return page(422, 'home', { recent: folders.recent(), value, error }, 'Prelude');
    const folder = folders.open(value);
    return redirect(res, `/f/${folder.id}`);
  }

  const forget = path.match(/^\/f\/([0-9a-f]+)\/forget$/);
  if (forget && req.method === 'POST') {
    folders.forget(forget[1]);
    return redirect(res, '/');
  }

  const folderMatch = path.match(/^\/f\/([0-9a-f]+)(\/.*)?$/);
  if (folderMatch) {
    const folder = folders.get(folderMatch[1]);
    if (!folder) return page(404, 'not-found', { what: 'That folder isn’t in your recent list. Open it again from the home page.' }, 'Not found');
    if (refuseFolder(folder.path)) {
      return page(404, 'not-found', { what: `${folder.path} is no longer there.`, forget: `/f/${folder.id}/forget` }, 'Not found');
    }
    const rest = folderMatch[2] ?? '';

    // The folder: its designs, grouped by area, and "New design".
    const view = (status, form, reference = { value: '', error: null }) => page(status, 'folder', {
      folder,
      groups: groupByArea(listDesigns(folder.path)),
      system: findSystem(folder.path),
      shell: findShell(folder.path),
      form,
      references: app.references.of(folder.id),
      reference,
    }, `${folder.name} · Prelude`);

    if (rest === '' && req.method === 'GET') {
      folders.open(folder.path);
      return view(200, { title: '', area: '', errors: {} });
    }

    // Reference folders: what else the agent may read while working here.
    // Approving the repository's design host: it runs the design's views as
    // code on this machine, so it starts only once the person says so.
    if (rest === '/host/approve' && req.method === 'POST') {
      const config = readHostConfig(folder.path);
      const form = await readForm(req);
      if (config) app.hosts.approve(folder, config);
      const back = String(form.get('back') ?? '');
      return redirect(res, back.startsWith(`/f/${folder.id}`) ? back : `/f/${folder.id}`);
    }

    if (rest === '/references' && req.method === 'POST') {
      const value = cleanPath((await readForm(req)).get('path'));
      const added = app.references.add(folder, value);
      if (added.error) return view(422, { title: '', area: '', errors: {} }, { value, error: added.error });
      return redirect(res, `/f/${folder.id}`);
    }

    if (rest === '/references/remove' && req.method === 'POST') {
      app.references.remove(folder.id, String((await readForm(req)).get('path') ?? ''));
      return redirect(res, `/f/${folder.id}`);
    }

    if (rest === '/designs' && req.method === 'POST') {
      const form = await readForm(req);
      const input = { title: form.get('title') ?? '', area: form.get('area') ?? '', kind: ['system', 'shell'].includes(form.get('kind')) ? form.get('kind') : 'design' };
      const result = createDesign(folder.path, input);
      if (result.errors) return view(422, { ...input, errors: result.errors });
      return redirect(res, `/f/${folder.id}/d/${result.design.id}`);
    }

    if (rest.startsWith('/d/')) {
      const found = findDesign(folder.path, rest.slice(3).split('/'));
      if (found) return handleDesign({ req, res, url, page, app, folder, ...found });
    }
  }

  return page(404, 'not-found', { what: 'There’s nothing at this address.' }, 'Not found');
}

// A design: its sessions, each a conversation with the agent.
//
//   GET  …/d/<design>                         its latest session (or an empty one)
//   GET  …/d/<design>/sessions/new            an empty session; the first message starts it
//   POST …/d/<design>/sessions                start a session with its first message
//   GET  …/d/<design>/sessions/<id>           a session
//   POST …/d/<design>/sessions/<id>/messages  send a message
//   POST …/d/<design>/sessions/<id>/stop      stop the agent
//   GET  …/d/<design>/sessions/<id>/live      the session's live channel
//   GET  …/d/<design>/preview?screen=<id>     the design surface, showing that screen
//   POST …/d/<design>/screen                  show a screen, in every window
//   GET  …/d/<design>/window                  the design surface alone, for a pop-out window
//   GET  …/d/<design>/live                    the design's channel: "design-changed"
async function handleDesign({ req, res, url, page, app, folder, design, dir, rest }) {
  const { turns, live, watches, designs } = app;
  const base = `/f/${folder.id}/d/${design.id}`;
  const title = `${design.title} · Prelude`;
  const notFound = () => page(404, 'not-found', { what: 'There’s no such session.' }, 'Not found');
  const dKey = designKey(folder, design);

  // The folder's design system, as this design uses it: null for the system
  // itself, or when the folder has none. `href` is the system's system/
  // folder relative to this design's screens/, as a screen links it.
  const systemFor = () => {
    const system = design.kind === 'system' ? null : findSystem(folder.path);
    if (!system) return null;
    const path = `${PRELUDE_DIR}/${system.id}`;
    return {
      id: system.id,
      title: system.title,
      path,
      href: posix.relative(`${PRELUDE_DIR}/${design.id}/screens`, `${path}/system`),
      hasIcons: existsSync(join(folder.path, PRELUDE_DIR, ...system.id.split('/'), 'system', 'icons.css')),
    };
  };

  // The folder's app shell, as this design renders in it: null for the shell
  // itself, or when the folder has none (designs then get the built-in layout).
  const shellFor = () => {
    const shell = design.kind === 'shell' ? null : findShell(folder.path);
    return shell && { id: shell.id, title: shell.title, path: `${PRELUDE_DIR}/${shell.id}` };
  };

  // The repository's own design host, when its app isn't Eta: what the design
  // bar says about it (approval, a log when it fails).
  const hostFor = () => {
    const config = readHostConfig(folder.path);
    if (!config) return null;
    const status = app.hosts.status(folder, config);
    return { start: config.start, approved: status.approved, running: status.running, log: status.log.slice(-4000), approve: `/f/${folder.id}/host/approve`, back: base };
  };

  // A design served by the Eta host (it has routes.json), or made of plain
  // screens/*.html. New designs, and the shell, are hosted; the design
  // system's gallery stays plain HTML, to render anywhere.
  const hosted = isHosted(dir);
  const format = () => {
    if (design.kind === 'system') return 'screens';
    if (hosted || design.kind === 'shell') return 'views';
    return listScreens(dir).length > 0 ? 'screens' : 'views';
  };

  // The design surface, as one window shows it: 'inline' beside the chat, or
  // 'window' when it has a window of its own. For a hosted design the
  // "screens" are its titled pages (routes.json), the frame is on the design's
  // own origin, and there is a state picker for its fake datasets.
  const viewOf = value => (value === 'window' ? 'window' : 'inline');
  const surface = view => {
    const common = {
      base,
      view,
      version: designs.version(dKey),
      popped: view === 'inline' && designs.windows(dKey) > 0,
      windowName: `prelude-${folder.id}-${design.id.replace(/[^a-z0-9]+/gi, '-')}`,
      host: hostFor(),
    };
    if (hosted) {
      const routes = readRoutes(dir);
      const states = listStates(dir);
      const state = states.find(s => s.id === designs.state(dKey)) ?? states[0] ?? null;
      // Every titled route, with sample ids from this state; overlays under
      // their page. A page followed to inside the frame may not be one of
      // them (another record), and is shown by its route's title.
      const screens = pickable(routes, datasetOf(app, dKey, dir, state)).map(pick => ({ ...pick, file: pick.id }));
      const path = designs.current(dKey) ?? screens[0]?.id ?? null;
      const matched = path && matchRoute(routes, path);
      const current = screens.find(screen => screen.id === path)
        ?? (matched ? { id: path, title: matched.route.title ?? path, file: path } : screens[0] ?? null);
      const origin = designOrigin(req, folder, design);
      const changed = designs.copy(dKey)?.stateId === (state?.id ?? null);
      return { ...common, hosted: true, screens, current, states, state, changed, frame: current && `${origin}${current.id}`, open: current && `${origin}${current.id}` };
    }
    const screens = listScreens(dir);
    const wanted = designs.current(dKey);
    const current = screens.find(screen => screen.id === wanted) ?? screens[0] ?? null;
    const files = `${previewOrigin(req)}/f/${folder.id}/p/${design.id}`;
    const at = current && `${files}/screens/${encodeURIComponent(current.file)}`;
    return { ...common, hosted: false, screens, current, states: [], state: null, changed: false, frame: at, open: at };
  };

  if (req.method === 'GET' && rest[0] === 'preview' && rest.length === 1) {
    return page(200, 'design', surface(viewOf(url.searchParams.get('view'))), title);
  }

  if (req.method === 'POST' && rest[0] === 'screen' && rest.length === 1) {
    const form = await readForm(req);
    const view = viewOf(form.get('view'));
    const wanted = String(form.get('screen') ?? '');
    const known = hosted
      ? Boolean(matchRoute(readRoutes(dir), wanted))
      : listScreens(dir).some(screen => screen.id === wanted);
    if (known) designs.show(dKey, wanted);
    return send(res, 200, render('./_design', surface(view)));
  }

  // "Reset data": throw away what forms changed, back to the state's file.
  if (req.method === 'POST' && rest[0] === 'reset' && rest.length === 1) {
    const form = await readForm(req);
    designs.resetCopy(dKey);
    return send(res, 200, render('./_design', surface(viewOf(form.get('view')))));
  }

  if (req.method === 'POST' && rest[0] === 'state' && rest.length === 1) {
    const form = await readForm(req);
    const wanted = String(form.get('state') ?? '');
    if (listStates(dir).some(state => state.id === wanted)) designs.showState(dKey, wanted);
    return send(res, 200, render('./_design', surface(viewOf(form.get('view')))));
  }

  if (req.method === 'GET' && rest[0] === 'window' && rest.length === 1) {
    const data = { surface: surface('window'), live: `${base}/live?view=window` };
    const body = render('./_window', data);
    if (req.headers['x-koda-fragment'] === '1') return send(res, 200, body);
    return send(res, 200, render('./layout', { body, path: url.pathname, title: `${design.title} · design`, bare: true }));
  }

  if (req.method === 'GET' && rest[0] === 'live' && rest.length === 1) {
    const release = watches.acquire(dKey, dir, () => designs.filesChanged(dKey));
    // A design's screens link its folder's design system, so they change when
    // the system does: watch that too, under a key of this design's own.
    const system = systemFor();
    const releaseSystem = system
      ? watches.acquire(`${dKey}>system`, join(folder.path, PRELUDE_DIR, ...system.id.split('/'), 'system'), () => designs.filesChanged(dKey))
      : () => {};
    // ...and its pages render in the shell's layouts, so watch the shell too.
    const shell = shellFor();
    const releaseShell = shell
      ? watches.acquire(`${dKey}>shell`, join(folder.path, PRELUDE_DIR, ...shell.id.split('/')), () => designs.filesChanged(dKey))
      : () => {};
    // A pop-out window says so by how it connects, and the inline surface
    // shrinks while one is open - and grows back when its channel closes.
    const closed = url.searchParams.get('view') === 'window' ? designs.windowOpened(dKey) : () => {};
    return live.open(designChannel(dKey), req, res, [], { onClose: () => { closed(); release(); releaseSystem(); releaseShell(); } });
  }

  const sessionView = (status, session, composer) => {
    const entries = session ? readEntries(dir, session.id) : [];
    const sessionUrl = session && `${base}/sessions/${session.id}`;
    return page(status, 'session', {
      folder,
      design,
      sessions: listSessions(dir),
      session,
      entries: entries.map(presentEntry),
      state: session ? turns.state(folder, design, session.id) : { kind: 'idle' },
      urls: { design: base, live: session && `${sessionUrl}/live?from=${entries.length}` },
      composer: { action: session ? `${sessionUrl}/messages` : `${base}/sessions`, self: Boolean(session), ...composer },
      surface: surface('inline'),
      designLive: `${base}/live`,
      system: systemFor(),
      shell: shellFor(),
    }, title);
  };

  // What the agent is told besides the design: what else it may read, the
  // folder's design system and shell, and which format the design is in. A
  // design made of views may also read Koda's own guidance.
  const agentContext = () => {
    const views = format() === 'views';
    const references = app.references.of(folder.id);
    return {
      references: views ? [...references, { name: 'Koda', path: kodaPackage }] : references,
      system: systemFor(),
      shell: shellFor(),
      format: format(),
      kodaPath: views ? kodaPackage : null,
      stack: (() => { const config = readHostConfig(folder.path); return config && { ext: config.views, guide: config.guide }; })(),
      // After each turn, render every route of a design of views, and say what fails.
      check: views
        ? () => (isHosted(dir) ? checkDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design, designDir: dir }) : Promise.resolve([]))
        : null,
    };
  };

  const [section, sessionId, action, ...extra] = rest;
  if (extra.length > 0) return notFound();

  if (section === undefined && req.method === 'GET') {
    const latest = listSessions(dir)[0];
    return latest ? redirect(res, `${base}/sessions/${latest.id}`) : sessionView(200, null, {});
  }

  if (section !== 'sessions') return notFound();

  if (sessionId === 'new' && action === undefined && req.method === 'GET') return sessionView(200, null, {});

  if (sessionId === undefined && req.method === 'POST') {
    const message = String((await readForm(req)).get('message') ?? '').trim();
    if (!message) return sessionView(422, null, { error: 'Write a message to start the session.' });
    const busy = turns.state(folder, design, null);
    if (busy.kind !== 'idle') return sessionView(409, null, { value: message, error: 'The agent is working on this design in another session. Wait for it to finish.' });
    const session = createSession(dir, { title: titleFrom(message) });
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${base}/sessions/${session.id}/stop`, ...agentContext() });
    if (started.error) return sessionView(409, null, { value: message, error: started.error });
    return redirect(res, `${base}/sessions/${session.id}`);
  }

  const session = sessionId && readSession(dir, sessionId);
  if (!session) return notFound();
  const sessionUrl = `${base}/sessions/${session.id}`;

  if (action === undefined && req.method === 'GET') return sessionView(200, session, {});

  if (action === 'messages' && req.method === 'POST') {
    const message = String((await readForm(req)).get('message') ?? '').trim();
    const composer = (status, data) => send(res, status, render('./_composer', { action: `${sessionUrl}/messages`, self: true, ...data }));
    if (!message) return composer(422, { error: 'Write a message first.' });
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${sessionUrl}/stop`, ...agentContext() });
    if (started.error) return composer(409, { value: message, error: started.error });
    return composer(200, {});
  }

  if (action === 'stop' && req.method === 'POST') {
    turns.stop(folder, design, session.id);
    return send(res, 200, render('./_status', { state: { kind: 'stopping' } }));
  }

  if (action === 'live' && req.method === 'GET') {
    const from = Math.max(0, Number.parseInt(url.searchParams.get('from') ?? '0', 10) || 0);
    // Catch up and subscribe in the same tick, so nothing published in between is missed.
    return live.open(sessionKey(folder, design, session.id), req, res, turns.catchUp(folder, design, dir, session.id, from));
  }

  return notFound();
}

export const PREVIEW_HOST = 'preview.localhost';

function isPreviewHost(req) {
  return String(req.headers.host ?? '').split(':')[0].toLowerCase() === PREVIEW_HOST;
}

/** Where this request's designs' files are served: the preview host, on the same port. */
export function previewOrigin(req) {
  const port = String(req.headers.host ?? '').split(':')[1];
  return `http://${PREVIEW_HOST}${port ? `:${port}` : ''}`;
}

/**
 * Did this request come from one of Prelude's own pages? Browsers say where a
 * request came from; a request saying nothing (curl, a test) is allowed.
 */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'vary': 'x-koda-fragment',
    'x-koda': '1',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { location, 'vary': 'x-koda-fragment', 'x-koda': '1' });
  res.end();
}

function serveFile(res, dir, rel) {
  const file = normalize(join(dir, rel));
  if (!file.startsWith(dir + sep)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  let stat;
  try { stat = statSync(file); } catch { stat = null; }
  if (!stat?.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const type = req.headers['content-type'] ?? '';
  // Koda posts FormData (multipart); a browser without script posts urlencoded.
  // Let the platform parse either - never decode multipart as text by hand.
  const request = new Request('http://localhost/', { method: 'POST', headers: { 'content-type': type }, body });
  return request.formData();
}
