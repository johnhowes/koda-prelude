// The built-in Eta host (plan: step 6): a design served the way the app would
// serve it.
//
// A design with a routes.json is the app's views, decomposed as the app
// decomposes them:
//
//   views/            Eta views: pages, and fragments (_row.eta) that pages
//                     include and that also answer alone
//   routes.json       { "/orders/:id": { "view": "orders/detail", "title": "Order",
//                                        "data": "orders/:id", "layout": "app" },
//                       "/orders/:id/edit": { ..., "over": "/orders/:id", "in": "drawer" } }
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
// An overlay - a route with "over" (the page beneath) and "in" (the region it
// is presented in, such as drawer or modal) - answers a fragment request with
// its view alone, as any fragment does, and a cold load with the page beneath,
// the overlay already in its region: the layout prints it from it.regions.
// That is how the app's server should answer a deep link to a drawer.
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
      over: typeof route.over === 'string' && route.over.startsWith('/') ? route.over : null,
      in: typeof route.in === 'string' && /^[a-z][a-z0-9-]*$/i.test(route.in) ? route.in : null,
    }));
}

/** The pages the screen picker offers: titled routes that need no parameters. */
export const pagesOf = routes => routes.filter(route => route.title && !route.pattern.includes(':'));

/**
 * What the preview's picker offers: every titled route, its :params filled
 * with sample ids from the dataset, each overlay listed after the page it is
 * presented over ("Order › Edit order"). [{ id: path, title, overlay? }]
 */
export function pickable(routes, dataset) {
  const samples = samplePaths(routes, dataset).filter(sample => sample.route.title);
  const pages = samples.filter(sample => !sample.route.over);
  const overlays = samples.filter(sample => sample.route.over);
  const picks = [];
  for (const page of pages) {
    picks.push({ id: page.path, title: page.route.title });
    for (const overlay of overlays) {
      if (fillParams(overlay.route.over, overlay.params) === page.path) {
        picks.push({ id: overlay.path, title: `${page.route.title} › ${overlay.route.title}`, overlay: true });
      }
    }
  }
  return picks;
}

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

/**
 * The design's POST routes, from keys like "POST /orders/:id": each does one
 * thing to the state's data at a path - update a record, add one to a list,
 * or remove one - refuses when a required field is empty, and answers.
 *   [{ pattern, verb, at, data, require, form, answer: { redirect, view, data, also, event } }]
 */
export function readPostRoutes(designDir) {
  let table;
  try { table = JSON.parse(readFileSync(join(designDir, 'routes.json'), 'utf8')); } catch { return []; }
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  const routes = [];
  for (const [key, route] of Object.entries(table)) {
    const match = key.match(/^POST\s+(\/\S*)$/);
    if (!match || !route || typeof route !== 'object') continue;
    const verb = ['update', 'add', 'remove'].find(name => typeof route[name] === 'string');
    if (!verb) continue;
    const answer = route.answer && typeof route.answer === 'object' ? route.answer : {};
    routes.push({
      pattern: match[1],
      verb,
      at: route[verb],
      data: route[verb],   // so samplePaths can fill its :params
      require: Array.isArray(route.require) ? route.require.filter(name => typeof name === 'string') : [],
      form: typeof route.form === 'string' ? route.form : null,
      answer: {
        redirect: typeof answer.redirect === 'string' ? answer.redirect : null,
        view: typeof answer.view === 'string' ? answer.view : null,
        data: typeof answer.data === 'string' ? answer.data : '',
        also: Array.isArray(answer.also) ? answer.also.filter(a => a && typeof a.into === 'string') : [],
        event: typeof answer.event === 'string' ? answer.event : null,
      },
    });
  }
  return routes;
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
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return sendHtml(res, 405, '<p>Designs answer GET and POST.</p>');

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
  const states = listStates(designDir);
  const state = states.find(s => s.id === app.designs.state(key)) ?? states[0] ?? null;
  const dataset = datasetOf(app, key, designDir, state);

  // A form: change a copy of the data, keep it if the post was accepted, and
  // answer as the app would (a redirect, a fragment, regions out of band).
  if (req.method === 'POST') {
    const fields = await readFormFields(req);
    const working = structuredClone(dataset);
    const answer = await postPath(app, { folder, design, designDir, path, fields, dataset: working });
    if (answer.changed && answer.status < 400) app.designs.setCopy(key, state?.id ?? null, working);
    if (answer.status === 303) {
      res.writeHead(303, { location: answer.location, 'x-koda': '1', vary: 'x-koda-fragment' });
      return res.end();
    }
    return sendHtml(res, answer.status, answer.html);
  }

  // A page loading in the preview's frame is the page on show: following a
  // link inside a design moves every window to it. A fragment, or a page in
  // a tab of its own, changes nothing.
  if (!fragment && req.headers['sec-fetch-dest'] === 'iframe' && matchRoute(readRoutes(designDir), path)) {
    app.designs.show(key, path, { shown: pickable(readRoutes(designDir), dataset)[0]?.id });
  }

  const answer = await renderPath(app, { folder, design, designDir, path, fragment, stateId: state?.id ?? null, dataset });
  return sendHtml(res, answer.status, answer.html);
}

/**
 * Render one of a design's URLs, as its origin would answer it:
 * { status, html }, with a 404 for a route or record that isn't there and a
 * 500 carrying the renderer's error. Used for requests, and for checking every
 * route after the agent's turn.
 */
export async function renderPath(app, { folder, design, designDir, path, fragment = false, stateId = null, dataset: given = null }) {
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
  const dataset = given ?? readState(designDir, state);
  const model = lookup(dataset, route.data, params);
  if (model === undefined) {
    return { status: 404, html: `<p>There's nothing at "${escape(route.data)}" in the ${state ? `"${escape(state.title)}"` : 'empty'} state.</p>` };
  }

  const views = join(designDir, 'views');
  const overlay = { views, template: `./${route.view}`, data: model };
  if (fragment) return render(app, folder, { page: overlay });

  // A cold load of an overlay: the page beneath, with the overlay in its
  // region. The page beneath must be a page, not another overlay.
  let pageRoute = route;
  let pagePath = path;
  let pageModel = model;
  const regions = {};
  if (route.over && route.in) {
    pagePath = fillParams(route.over, params);
    const beneath = matchRoute(routes, pagePath);
    if (!beneath || beneath.route.over) {
      return { status: 404, html: `<p>The page beneath this overlay, ${escape(pagePath)}, isn't a page of this design.</p>` };
    }
    pageModel = lookup(dataset, beneath.route.data, beneath.params);
    if (pageModel === undefined) {
      return { status: 404, html: `<p>There's nothing at "${escape(beneath.route.data)}" for the page beneath, in this state.</p>` };
    }
    pageRoute = beneath.route;
    regions[route.in] = { ...overlay, location: path };
  }

  const found = findLayout({ folderPath: folder.path, designDir, shellDir: dirOf('shell'), name: pageRoute.layout })
    ?? { views: BUILT_IN_LAYOUTS, template: './layout', sample: {} };
  const shellData = { ...found.sample, ...(dataset.layout && typeof dataset.layout === 'object' ? dataset.layout : {}) };
  return render(app, folder, {
    page: { views, template: `./${pageRoute.view}`, data: pageModel },
    layout: {
      views: found.views,
      template: found.template,
      data: {
        ...shellData,
        layout: shellData,
        title: route.title ?? pageRoute.title ?? design.title,
        location: pagePath,
        path: pagePath,
        hasSystem: Boolean(dirOf('system')),
      },
    },
    regions,
  });
}

/** Ask the folder's sandboxed renderer for a page: { status, html, error? }. */
async function render(app, folder, job) {
  try {
    return { status: 200, html: await app.renderers.render(folder.path, job) };
  } catch (error) {
    const message = String(error.message);
    return { status: 500, html: `<pre class="prelude-render-error">${message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`, error: message };
  }
}

/** "/orders/:id" with { id: "7" } -> "/orders/7". */
export function fillParams(pattern, params) {
  return pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => encodeURIComponent(params[name] ?? ''));
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
    const path = fillParams(route.pattern, params);
    if (path.includes('//') || /\/$/.test(path) && path !== '/') continue;
    paths.push({ route, path, params, fragment: !route.title });
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
    // Each POST route, against a throwaway copy: a valid post must answer as
    // described, and an empty one must be refused when fields are required.
    for (const { route, path } of samplePaths(readPostRoutes(designDir), readState(designDir, state))) {
      const label = `POST ${path}`;
      const record = route.verb === 'update' ? lookup(readState(designDir, state), route.at, matchRoute([route], path)?.params ?? {}) : null;
      const valid = Object.fromEntries([
        ...Object.entries(record && typeof record === 'object' ? record : {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)]),
        ...route.require.map(name => [name, String(record?.[name] ?? 'Sample')]),
      ]);
      const ok = await postPath(app, { folder, design, designDir, path, fields: valid, dataset: structuredClone(readState(designDir, state)) });
      if (ok.status >= 400) failures.push({ state: state?.title ?? null, path: label, error: ok.error ?? `answered ${ok.status}: ${ok.html.replace(/<[^>]+>/g, '').slice(0, 200)}` });
      if (route.require.length) {
        const refused = await postPath(app, { folder, design, designDir, path, fields: {}, dataset: structuredClone(readState(designDir, state)) });
        if (refused.status !== 422) failures.push({ state: state?.title ?? null, path: `${label} (empty)`, error: refused.error ?? `should refuse with 422, answered ${refused.status}` });
      }
    }
    for (const { route, path, fragment } of samplePaths(routes, readState(designDir, state))) {
      // An overlay is rendered both ways: alone, and over the page beneath.
      for (const alone of route.over ? [true, false] : [fragment]) {
        const answer = await renderPath(app, { folder, design, designDir, path, fragment: alone, stateId: state?.id });
        if (answer.status === 500) failures.push({ state: state?.title ?? null, path: route.over && alone ? `${path} (alone)` : path, error: answer.error });
      }
    }
  }
  return failures;
}

// --- forms: POST routes ----------------------------------------------------

/**
 * The dataset a design's routes read now: the working copy, if forms have
 * changed the current state's data, else the state's file.
 */
export function datasetOf(app, key, designDir, state) {
  const copy = app.designs?.copy?.(key);
  if (copy && copy.stateId === (state?.id ?? null)) return copy.data;
  return readState(designDir, state);
}

/** A posted form as an object; a name posted twice keeps its last value. */
export async function readFormFields(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? 'application/x-www-form-urlencoded' },
    body: Buffer.concat(chunks),
  });
  const fields = {};
  for (const [name, value] of (await request.formData()).entries()) {
    if (typeof value === 'string') fields[name] = value;
  }
  return fields;
}

/**
 * A posted string, typed like the value it replaces: a number stays a number,
 * a boolean a boolean ("on", "true", "1" are true; a checkbox sends a hidden
 * "false" before it, so an unchecked box still says so).
 */
function typed(value, like) {
  if (typeof like === 'number') return value.trim() === '' || Number.isNaN(Number(value)) ? value : Number(value);
  if (typeof like === 'boolean') return ['on', 'true', '1', 'yes'].includes(value.toLowerCase());
  return value;
}

/** Set each field on a record; "address.city" reaches inside. */
function mergeFields(record, fields) {
  for (const [name, value] of Object.entries(fields)) {
    const steps = name.split('.').filter(Boolean);
    if (steps.length === 0 || steps.some(step => step === '__proto__' || step === 'constructor' || step === 'prototype')) continue;
    let here = record;
    for (const step of steps.slice(0, -1)) {
      if (!here[step] || typeof here[step] !== 'object') here[step] = {};
      here = here[step];
    }
    const last = steps.at(-1);
    here[last] = typed(value, here[last]);
  }
  return record;
}

/** The next id for a list: one more than the largest number, or a short random one. */
function nextId(list) {
  const ids = list.map(item => item?.id);
  if (ids.length && ids.every(id => Number.isFinite(Number(id)))) return Math.max(...ids.map(Number)) + 1;
  return Math.random().toString(36).slice(2, 8);
}

/** The list holding a path's last step, and that step's index or key in it. */
function locate(data, path, params) {
  const steps = path.split('/').filter(Boolean);
  const parent = steps.length > 1 ? lookup(data, steps.slice(0, -1).join('/'), params) : data;
  const last = steps.at(-1);
  if (parent === null || typeof parent !== 'object' || last === undefined) return null;
  const key = last.startsWith(':') ? params[last.slice(1)] : last;
  if (Array.isArray(parent)) {
    const index = parent.findIndex(item => item && typeof item === 'object' && String(item.id) === String(key));
    return index < 0 ? null : { parent, key: index };
  }
  return key in parent ? { parent, key } : null;
}

/** Apply a POST route's verb to the data, in place. Returns { params } (with :new) or { missing }. */
export function applyChange(data, route, params, fields) {
  const after = { ...params };
  if (route.verb === 'update') {
    const record = lookup(data, route.at, params);
    if (!record || typeof record !== 'object') return { missing: route.at };
    mergeFields(record, fields);
  } else if (route.verb === 'add') {
    const list = lookup(data, route.at, params);
    if (!Array.isArray(list)) return { missing: route.at };
    const id = nextId(list);
    list.push(mergeFields({ id }, fields));
    after.new = String(id);
  } else if (route.verb === 'remove') {
    const found = locate(data, route.at, params);
    if (!found) return { missing: route.at };
    if (Array.isArray(found.parent)) found.parent.splice(found.key, 1);
    else delete found.parent[found.key];
  }
  return { params: after };
}

const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** An out-of-band fragment for a region; table parts travel in a template, as Koda requires. */
function envelope(into, html = '') {
  const tag = /^\s*<(tr|td|th|thead|tbody|tfoot|caption|colgroup|col)[\s>]/i.test(html) ? 'template' : 'div';
  return `<${tag} ko-into="${escapeHtml(into)}">${html}</${tag}>`;
}

/**
 * Answer a POST to a design's URL, against `dataset` (changed in place):
 * { status, html, location?, changed }. A refusal (422) changes nothing and
 * re-renders the route's form with what was typed and it.$errors.
 */
export async function postPath(app, { folder, design, designDir, path, fields, dataset }) {
  const posts = readPostRoutes(designDir);
  const matched = matchRoute(posts, path);
  if (!matched) return { status: 404, html: `<p>This design has no POST route for ${escapeHtml(path)}.</p>`, changed: false };
  const { route, params } = matched;
  const views = join(designDir, 'views');
  const renderView = (view, data) => render(app, folder, { page: { views, template: `./${view}`, data } });

  // Refused: a required field is empty. Nothing changes; the form comes back
  // with what was typed, and each refused field's message.
  const missing = route.require.filter(name => !String(fields[name] ?? '').trim());
  if (missing.length) {
    const $errors = Object.fromEntries(missing.map(name => [name, 'This is required.']));
    if (!route.form) return { status: 422, html: `<p>Required: ${missing.map(escapeHtml).join(', ')}.</p>`, changed: false };
    const record = route.verb === 'update' ? lookup(dataset, route.at, params) : null;
    const model = mergeFields(structuredClone(record && typeof record === 'object' ? record : {}), fields);
    const answer = await renderView(route.form, { ...model, $errors });
    return { status: answer.status === 200 ? 422 : answer.status, html: answer.html, error: answer.error, changed: false };
  }

  const applied = applyChange(dataset, route, params, fields);
  if (applied.missing) return { status: 404, html: `<p>There's nothing at "${escapeHtml(applied.missing)}" to change.</p>`, changed: false };
  const after = applied.params;

  const { answer } = route;
  if (answer.redirect) {
    return { status: 303, location: fillParams(answer.redirect, after), html: '', changed: true };
  }

  // A fragment for wherever the form aimed it, plus anything out of band.
  const parts = [];
  if (answer.view) {
    const main = await renderView(answer.view, lookup(dataset, answer.data, after));
    if (main.status !== 200) return { ...main, changed: true };
    parts.push(answer.event ? main.html.replace(/^(\s*<[a-z][a-z0-9-]*)/i, `$1 ko-event="${escapeHtml(answer.event)}"`) : main.html);
  } else if (answer.event) {
    parts.push(envelope('prelude-events?', `<i hidden ko-event="${escapeHtml(answer.event)}"></i>`));
  }
  for (const also of answer.also) {
    if (!also.view) { parts.push(envelope(also.into)); continue; }   // the empty envelope: close that region
    const part = await renderView(also.view, lookup(dataset, typeof also.data === 'string' ? also.data : '', after));
    if (part.status !== 200) return { ...part, changed: true };
    parts.push(envelope(also.into, part.html));
  }
  // An answer with nothing to show still has to say so: an answer made only of
  // addressed fragments leaves the asking region alone, and this one is
  // addressed to a region no page has, so Koda drops it.
  if (parts.length === 0) parts.push(envelope('prelude-nothing?'));
  return { status: 200, html: parts.join('\n'), changed: true };
}
