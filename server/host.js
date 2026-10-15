// The built-in Eta host (plan: step 6): a design served the way the app would
// serve it.
//
// A design with a routes.json is the app's views, decomposed as the app
// decomposes them:
//
//   views/            Eta views: pages, and fragments (_row.eta) that pages
//                     include and that also answer alone
//   routes.json       { "/orders/:id": { "view": "orders/detail", "title": "Order",
//                                        "data": "orders/:id", "layout": "app" } }
//   states/           NN-name.json: each a fake dataset for the whole design;
//                     the first is the default. "layout" in a state overrides
//                     the shell's sample data.
//
// Each design is served on an origin of its own,
// <design>.<folder>.preview.localhost, so its routes are the app's real URLs
// and Koda's ko-scope="/" owns the page as it will in production. One URL
// answers in two shapes, as a Koda server does: the view alone for a region
// (x-koda-fragment: 1), inside its layout for anything else.
//
// Layouts come from, in order: the design's own views/layouts/<name>.eta, the
// folder's shell (layouts/<name>.eta, "kind": "shell"), a real layout in the
// repository ("@app/<path>", read-only), or a minimal built-in one.
//
// Views render in a sandboxed process (renderers.js), never in this one.
//
// Under /_prelude/ the origin also serves what pages link: Koda (koda/), the
// folder's design system (system/), the shell's files (shell/) and the
// design's own files (design/). Never a sessions/ folder.

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRELUDE_DIR, findKind, listDesigns } from './designs.js';

export const HOST_SUFFIX = 'preview.localhost';

const here = dirname(fileURLToPath(import.meta.url));
const BUILT_IN_LAYOUTS = join(here, 'views', 'host');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// --- naming a design's origin ----------------------------------------------

const label = designId => designId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** http://<design>.<folder>.preview.localhost:<port>, from the port this request came in on. */
export function designOrigin(req, folder, design) {
  const port = String(req.headers.host ?? '').split(':')[1];
  return `http://${label(design.id)}.${folder.id}.${HOST_SUFFIX}${port ? `:${port}` : ''}`;
}

/** { designLabel, folderId } if this request is for a design's origin, else null. */
export function designHostOf(req) {
  const name = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  if (!name.endsWith(`.${HOST_SUFFIX}`)) return null;
  const labels = name.slice(0, -(HOST_SUFFIX.length + 1)).split('.');
  if (labels.length !== 2 || !labels[0] || !/^[0-9a-f]+$/.test(labels[1])) return null;
  return { designLabel: labels[0], folderId: labels[1] };
}

// --- a design's routes and states ------------------------------------------

/** Whether a design is served by the host: it has a routes.json. */
export const isHosted = designDir => existsSync(join(designDir, 'routes.json'));

/** The design's routes, in the order written: [{ pattern, view, title, data, layout }]. */
export function readRoutes(designDir) {
  let table;
  try { table = JSON.parse(readFileSync(join(designDir, 'routes.json'), 'utf8')); } catch { return []; }
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  return Object.entries(table)
    .filter(([pattern, route]) => pattern.startsWith('/') && route && typeof route.view === 'string')
    .map(([pattern, route]) => ({
      pattern,
      view: route.view,
      title: typeof route.title === 'string' ? route.title : null,
      data: typeof route.data === 'string' ? route.data : '',
      layout: typeof route.layout === 'string' ? route.layout : 'app',
    }));
}

/** The pages the screen picker offers: titled routes that need no parameters. */
export const pagesOf = routes => routes.filter(route => route.title && !route.pattern.includes(':'));

/** Match a path against the routes, first match wins: { route, params } or null. */
export function matchRoute(routes, path) {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    const pattern = route.pattern.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    if (pattern.every((segment, i) => {
      if (segment.startsWith(':')) { params[segment.slice(1)] = decodeURIComponent(parts[i]); return true; }
      return segment === parts[i];
    })) return { route, params };
  }
  return null;
}

/** "02-empty.json" -> { id: "empty", file, title: "Empty" }, in file-name order. */
export function listStates(designDir) {
  let files;
  try { files = readdirSync(join(designDir, 'states')); } catch { return []; }
  return files
    .filter(file => /\.json$/i.test(file) && !file.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(file => {
      const id = file.replace(/\.json$/i, '').replace(/^\d+[-_ ]*/, '') || file;
      const words = id.replace(/[-_]+/g, ' ');
      return { id, file, title: words[0].toUpperCase() + words.slice(1) };
    });
}

export function readState(designDir, state) {
  if (!state) return {};
  try { return JSON.parse(readFileSync(join(designDir, 'states', state.file), 'utf8')) ?? {}; } catch { return {}; }
}

/**
 * Walk the dataset along a route's data path. "orders/:id/lines": a property,
 * then - in a list - the record whose id is the route's :id, then a property.
 * An empty path is the whole dataset. Undefined when it isn't there.
 */
export function lookup(data, path, params) {
  let here = data;
  for (const step of path.split('/').filter(Boolean)) {
    if (here === null || here === undefined) return undefined;
    const key = step.startsWith(':') ? params[step.slice(1)] : step;
    if (key === undefined) return undefined;
    here = Array.isArray(here)
      ? here.find(item => item && typeof item === 'object' && String(item.id) === String(key))
      : here[key];
  }
  return here;
}

// --- layouts ---------------------------------------------------------------

/**
 * Where a route's layout comes from: { views, template, sample } or null.
 * "@app/<path>" is a real layout in the repository, read in place.
 */
export function findLayout({ folderPath, designDir, shellDir, name }) {
  if (name.startsWith('@app/')) {
    const file = normalize(join(folderPath, `${name.slice(5)}${extname(name) ? '' : '.eta'}`));
    if (!file.startsWith(folderPath + sep) || !existsSync(file)) return null;
    return { views: dirname(file), template: `./${file.slice(dirname(file).length + 1)}`, sample: {} };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) return null;
  const candidates = [
    designDir && join(designDir, 'views', 'layouts'),
    shellDir && join(shellDir, 'layouts'),
  ].filter(Boolean);
  for (const views of candidates) {
    if (existsSync(join(views, `${name}.eta`))) {
      let sample = {};
      try { sample = JSON.parse(readFileSync(join(views, `${name}.json`), 'utf8')) ?? {}; } catch { /* no sample */ }
      return { views, template: `./${name}`, sample };
    }
  }
  return null;
}

// --- answering -------------------------------------------------------------

function sendFile(res, root, rel, notFound) {
  const parts = rel.split('/');
  if (parts.some(p => p === '' || p === 'sessions' || p.startsWith('.'))) return notFound();
  const file = normalize(join(root, ...parts));
  if (!file.startsWith(root + sep)) return notFound();
  let stat;
  try { stat = statSync(file); } catch { stat = null; }
  if (!stat?.isFile()) return notFound();
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'vary': 'x-koda-fragment',
    'x-koda': '1',
    'cache-control': 'no-store',
  });
  res.end(html);
}

/**
 * Answer a request on a design's origin.
 *   app: { folders, designs (design-state), renderers, kodaDir, designKey }
 */
export async function handleDesignHost(req, res, app, host) {
  const notFound = (message = 'Not found') => sendHtml(res, 404, `<p>${message}</p>`);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendHtml(res, 405, '<p>Designs answer GET only, for now.</p>');

  const folder = app.folders.get(host.folderId);
  if (!folder) return notFound();
  const design = listDesigns(folder.path).find(candidate => label(candidate.id) === host.designLabel);
  if (!design) return notFound();
  const designDir = join(folder.path, PRELUDE_DIR, ...design.id.split('/'));
  const dirOf = kind => {
    const found = findKind(folder.path, kind);
    return found && join(folder.path, PRELUDE_DIR, ...found.id.split('/'));
  };

  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/_prelude/')) {
    const [, , area, ...rest] = path.split('/');
    const rel = rest.join('/');
    if (area === 'koda') return sendFile(res, app.kodaDir, rel, notFound);
    if (area === 'design') return sendFile(res, designDir, rel, notFound);
    if (area === 'system' && dirOf('system')) return sendFile(res, join(dirOf('system'), 'system'), rel, notFound);
    if (area === 'shell' && dirOf('shell')) return sendFile(res, dirOf('shell'), rel, notFound);
    return notFound();
  }

  const fragment = req.headers['x-koda-fragment'] === '1';
  const key = app.designKey(folder, design);

  // A page loading in the preview's frame is the page on show: following a
  // link inside a design moves every window to it. A fragment, or a page in
  // a tab of its own, changes nothing.
  if (!fragment && req.headers['sec-fetch-dest'] === 'iframe' && matchRoute(readRoutes(designDir), path)) {
    app.designs.show(key, path, { shown: pagesOf(readRoutes(designDir))[0]?.pattern });
  }

  const answer = await renderPath(app, { folder, design, designDir, path, fragment, stateId: app.designs.state(key) });
  return sendHtml(res, answer.status, answer.html);
}

/**
 * Render one of a design's URLs, as its origin would answer it:
 * { status, html }, with a 404 for a route or record that isn't there and a
 * 500 carrying the renderer's error. Used for requests, and for checking every
 * route after the agent's turn.
 */
export async function renderPath(app, { folder, design, designDir, path, fragment = false, stateId = null }) {
  const escape = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const dirOf = kind => {
    const found = findKind(folder.path, kind);
    return found && join(folder.path, PRELUDE_DIR, ...found.id.split('/'));
  };

  const routes = readRoutes(designDir);
  const matched = matchRoute(routes, path);
  if (!matched) return { status: 404, html: `<p>This design has no route for ${escape(path)}.</p>` };
  const { route, params } = matched;

  const states = listStates(designDir);
  const state = states.find(s => s.id === stateId) ?? states[0] ?? null;
  const dataset = readState(designDir, state);
  const model = lookup(dataset, route.data, params);
  if (model === undefined) {
    return { status: 404, html: `<p>There's nothing at "${escape(route.data)}" in the ${state ? `"${escape(state.title)}"` : 'empty'} state.</p>` };
  }

  const page = { views: join(designDir, 'views'), template: `./${route.view}`, data: model };
  let layout = null;
  if (!fragment) {
    const found = findLayout({ folderPath: folder.path, designDir, shellDir: dirOf('shell'), name: route.layout })
      ?? { views: BUILT_IN_LAYOUTS, template: './layout', sample: {} };
    const shellData = { ...found.sample, ...(dataset.layout && typeof dataset.layout === 'object' ? dataset.layout : {}) };
    layout = {
      views: found.views,
      template: found.template,
      data: { ...shellData, layout: shellData, title: route.title ?? design.title, location: path, path, hasSystem: Boolean(dirOf('system')) },
    };
  }

  try {
    return { status: 200, html: await app.renderers.render(folder.path, { page, layout }) };
  } catch (error) {
    return { status: 500, html: `<pre class="prelude-render-error">${escape(error.message)}</pre>`, error: String(error.message) };
  }
}

/**
 * A concrete path for each route, to render it as a check: each :param is
 * filled with the id of the first record its data path reaches in the
 * dataset. A route whose records aren't there (an empty state) is skipped.
 */
export function samplePaths(routes, dataset) {
  const paths = [];
  for (const route of routes) {
    const params = {};
    let here = dataset;
    let ok = true;
    for (const step of route.data.split('/').filter(Boolean)) {
      if (here === null || here === undefined) { ok = false; break; }
      if (step.startsWith(':')) {
        const first = Array.isArray(here) ? here.find(item => item && item.id !== undefined) : undefined;
        if (!first) { ok = false; break; }
        params[step.slice(1)] = String(first.id);
        here = first;
      } else {
        here = here[step];
      }
    }
    if (!ok) continue;
    const path = route.pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => encodeURIComponent(params[name] ?? ''));
    if (path.includes('//') || /\/$/.test(path) && path !== '/') continue;
    paths.push({ route, path, fragment: !route.title });
  }
  return paths;
}

/**
 * Render every route of a hosted design in each of its states, and report
 * what fails: [{ state, path, error }]. Pages render in their layout, routes
 * without a title as fragments.
 */
export async function checkDesign(app, { folder, design, designDir }) {
  const routes = readRoutes(designDir);
  const states = listStates(designDir);
  const failures = [];
  for (const state of states.length ? states : [null]) {
    for (const { path, fragment } of samplePaths(routes, readState(designDir, state))) {
      const answer = await renderPath(app, { folder, design, designDir, path, fragment, stateId: state?.id });
      if (answer.status === 500) failures.push({ state: state?.title ?? null, path, error: answer.error });
    }
  }
  return failures;
}
