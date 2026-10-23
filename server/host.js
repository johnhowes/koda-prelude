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
import { appAssets } from './app-config.js';
import { readHostConfig } from './hosts.js';
import { LIVE_PATH, readEvents } from './events.js';
import { readRules, ruleWarnings } from './rules.js';
import { compareSnapshots, snapshotName } from './snapshots.js';

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
  return parseRoutes(readTable(designDir));
}

/** A design's routes.json as an object, or null. */
function readTable(designDir) {
  try { return JSON.parse(readFileSync(join(designDir, 'routes.json'), 'utf8')); } catch { return null; }
}

/** The GET routes in a routes.json table (readRoutes, for a table read from elsewhere: git, step 10). */
export function parseRoutes(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  return Object.entries(table)
    .filter(([pattern, route]) => pattern.startsWith('/') && route && typeof route.view === 'string')
    .map(([pattern, route]) => ({
      pattern,
      view: route.view,
      ported: route.view.startsWith('@app/'),
      title: typeof route.title === 'string' ? route.title : null,
      data: typeof route.data === 'string' ? route.data : '',
      layout: typeof route.layout === 'string' ? route.layout : 'app',
      over: typeof route.over === 'string' && route.over.startsWith('/') ? route.over : null,
      in: typeof route.in === 'string' && /^[a-z][a-z0-9-]*$/i.test(route.in) ? route.in : null,
      search: fieldMap(route.search, value => (Array.isArray(value) ? value.filter(f => typeof f === 'string') : typeof value === 'string' ? [value] : [])),
      match: fieldMap(route.match, value => (typeof value === 'string' ? value : null)),
      list: typeof route.list === 'string' ? route.list : null,
      // A built view brought back into the design for a redesign (step 10): where it came from.
      from: typeof route.from === 'string' && route.from.startsWith('@app/') ? route.from : null,
    }));
}

/** { param: fields } from routes.json, keeping only well-formed entries. */
function fieldMap(value, read) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [param, fields] of Object.entries(value)) {
    const read_ = read(fields);
    if (read_ && (!Array.isArray(read_) || read_.length)) out[param] = read_;
  }
  return out;
}

/** A field of a record by dotted path: "borrower.name". */
const fieldOf = (record, path) => path.split('.').reduce((here, step) => (here && typeof here === 'object' ? here[step] : undefined), record);

/**
 * A GET route's search and filters, applied to its model as the app's
 * controller would apply them to its query:
 *   "search": { "q": ["borrower.name", "id"] }   any of the fields contains ?q=, ignoring case
 *   "match":  { "status": "status" }             the field equals ?status=
 * An empty or absent parameter filters nothing. They apply to the model when
 * it is a list, or to the list at "list" inside it.
 */
export function filterModel(model, route, query) {
  const searches = Object.entries(route.search ?? {}).filter(([param]) => String(query[param] ?? '').trim());
  const matches = Object.entries(route.match ?? {}).filter(([param]) => String(query[param] ?? '').trim());
  if (!searches.length && !matches.length) return model;
  const keep = item => searches.every(([param, fields]) => {
    const wanted = String(query[param]).trim().toLowerCase();
    return fields.some(field => String(fieldOf(item, field) ?? '').toLowerCase().includes(wanted));
  }) && matches.every(([param, field]) => String(fieldOf(item, field) ?? '') === String(query[param]).trim());

  if (!route.list) return Array.isArray(model) ? model.filter(keep) : model;
  const copy = structuredClone(model);
  const steps = route.list.split('/').filter(Boolean);
  const holder = steps.length > 1 ? lookup(copy, steps.slice(0, -1).join('/'), {}) : copy;
  const last = steps.at(-1);
  if (holder && typeof holder === 'object' && Array.isArray(holder[last])) holder[last] = holder[last].filter(keep);
  return copy;
}

/** The pages the screen picker offers: titled routes that need no parameters. */
export const pagesOf = routes => routes.filter(route => route.title && !route.pattern.includes(':'));

/**
 * What the preview's picker offers: every titled route, its :params filled
 * with sample ids from the dataset, each overlay listed after the page it is
 * presented over ("Order › Edit order"). [{ id: path, title, overlay?, ported }]
 */
export function pickable(routes, dataset) {
  const samples = samplePaths(routes, dataset).filter(sample => sample.route.title);
  const pages = samples.filter(sample => !sample.route.over);
  const overlays = samples.filter(sample => sample.route.over);
  const picks = [];
  for (const page of pages) {
    picks.push({ id: page.path, title: page.route.title, ported: page.route.ported });
    for (const overlay of overlays) {
      if (fillParams(overlay.route.over, overlay.params) === page.path) {
        picks.push({ id: overlay.path, title: `${page.route.title} › ${overlay.route.title}`, overlay: true, ported: overlay.route.ported });
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
  return parsePostRoutes(readTable(designDir));
}

/** The POST routes in a routes.json table. */
export function parsePostRoutes(table) {
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

// --- views -----------------------------------------------------------------

/**
 * Where a route's view is: { views, template }, or { error }.
 * "orders/list" is the design's own (views/orders/list); "@app/<path>" is a
 * ported route's, the app's own file in the repository, read in place.
 */
export function viewOf({ folderPath, designDir, view, ext = '.eta' }) {
  if (!view.startsWith('@app/')) return { views: join(designDir, 'views'), template: `./${view}` };
  const file = normalize(join(folderPath, `${view.slice(5)}${extname(view) ? '' : ext}`));
  if (!file.startsWith(folderPath + sep)) return { error: `The view ${view} is outside the repository.` };
  if (!existsSync(file)) return { error: `There's no view at ${view} (looked for ${file.slice(folderPath.length + 1).split(sep).join('/')}).` };
  const base = file.slice(dirname(file).length + 1);
  return { views: dirname(file), template: `./${base.slice(0, base.length - extname(base).length)}` };
}

// --- layouts ---------------------------------------------------------------

/** The shell's layouts that are the app's own files, from its layouts.json: { name: "@app/<path>" }. */
export function shellLayoutLinks(shellDir) {
  let links;
  try { links = JSON.parse(readFileSync(join(shellDir, 'layouts.json'), 'utf8')); } catch { return {}; }
  if (!links || typeof links !== 'object' || Array.isArray(links)) return {};
  return Object.fromEntries(Object.entries(links).filter(([name, path]) => /^[a-z0-9][a-z0-9-]*$/i.test(name) && typeof path === 'string' && path.startsWith('@app/')));
}

/** The shell's own layouts, by name: each layouts/<name><ext> that isn't a partial (_name). */
export function shellLayouts(shellDir, ext = '.eta') {
  let files;
  try { files = readdirSync(join(shellDir, 'layouts')); } catch { return []; }
  return files.filter(file => file.endsWith(ext) && !file.startsWith('_') && !file.startsWith('.')).map(file => file.slice(0, -ext.length)).sort();
}

/**
 * Every layout the shell has, by name: its own, and those that are the app's
 * files in layouts.json (once ported, or connected from an app it already
 * had, the shell keeps no copy of the layout itself).
 */
export function allShellLayouts(shellDir, ext = '.eta') {
  return [...new Set([...shellLayouts(shellDir, ext), ...Object.keys(shellLayoutLinks(shellDir))])].sort();
}

/**
 * The shell's layouts the app hasn't got yet (8c): designed in the shell and
 * not linked to an app file in layouts.json. Once the app exists, these are
 * the shell's Layouts group, built before the features whose pages use them.
 */
export function unbuiltLayouts(shellDir, ext = '.eta') {
  const links = shellLayoutLinks(shellDir);
  return shellLayouts(shellDir, ext).filter(name => !links[name]);
}

/**
 * Where a route's layout comes from: { views, template, sample } or null.
 * "@app/<path>" is a real layout in the repository, read in place.
 */
export function findLayout({ folderPath, designDir, shellDir, name, ext = '.eta' }) {
  // A shell layout ported to the app (step 8): the shell's layouts.json names
  // the app's file, and its sample data stays in the shell.
  // (A design's own draft of the layout still comes first.)
  const ownDraft = designDir && existsSync(join(designDir, 'views', 'layouts', `${name}${ext}`));
  const link = !ownDraft && shellDir && shellLayoutLinks(shellDir)[name];
  if (link) {
    const found = findLayout({ folderPath, name: link, ext });
    if (found) {
      let sample = {};
      try { sample = JSON.parse(readFileSync(join(shellDir, 'layouts', `${name}.json`), 'utf8')) ?? {}; } catch { /* no sample */ }
      return { ...found, sample };
    }
  }
  if (name.startsWith('@app/')) {
    const file = normalize(join(folderPath, `${name.slice(5)}${extname(name) ? '' : ext}`));
    if (!file.startsWith(folderPath + sep) || !existsSync(file)) return null;
    const base = file.slice(dirname(file).length + 1);
    return { views: dirname(file), template: `./${base.slice(0, base.length - extname(base).length)}`, sample: {} };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) return null;
  const candidates = [
    designDir && join(designDir, 'views', 'layouts'),
    shellDir && join(shellDir, 'layouts'),
  ].filter(Boolean);
  for (const views of candidates) {
    if (existsSync(join(views, `${name}${ext}`))) {
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
 *   app: { folders, designs (design-state), renderers, kodaDirOf, designKey }
 * kodaDirOf(folder) is where the app's own Koda runtime is (D-k7v), so a
 * design's pages behave as the app's will.
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
    if (area === 'koda') return sendFile(res, app.kodaDirOf(folder), rel, notFound);
    if (area === 'design') return sendFile(res, designDir, rel, notFound);
    if (area === 'system' && dirOf('system')) return sendFile(res, join(dirOf('system'), 'system'), rel, notFound);
    if (area === 'shell' && dirOf('shell')) return sendFile(res, dirOf('shell'), rel, notFound);
    // The design's live channel (6e): server events sent from the design bar.
    if (area === 'live' && !rel && app.channels) return app.channels.join(app.designKey(folder, design), req, res);
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

  // Another stack's host serves the app's own assets at their real paths;
  // anything the design has no route for goes to it.
  const external = app.hosts && readHostConfig(folder.path);
  if (external && !matchRoute(readRoutes(designDir), path)) {
    if (await app.hosts.proxy(folder, external, req.url, res)) return;
  }
  // An app connected without a host (8b) names its own files' URLs in
  // prelude.json, so the pages it renders load them here at the same paths.
  // In a design's worktree, what isn't committed (node_modules, where an app
  // may name Koda) isn't there: it comes from the repository it's a branch of.
  if (!external && req.method === 'GET' && !matchRoute(readRoutes(designDir), path)) {
    const parent = folder.branch && app.folders.get(folder.branch.parentId);
    const asset = [folder, parent].filter(Boolean)
      .map(owner => appAssets(owner.path).find(({ prefix }) => path.startsWith(prefix)))
      .find(found => found && existsSync(found.root));
    if (asset) return sendFile(res, asset.root, path.slice(asset.prefix.length), notFound);
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const answer = await renderPath(app, { folder, design, designDir, path, query, fragment, stateId: state?.id ?? null, dataset });
  return sendHtml(res, answer.status, fragment ? answer.html : withClient(answer.html));
}

/**
 * A client (prelude/design-workspace, R-4tw) is attributes on the page's
 * root: the design surface's frame names them in its name
 * ("prelude-client:{…}"), which stays with the frame as links in it are
 * followed, and each page sets them before it paints. Only on the design's
 * origin, as served: what's rendered for the check is untouched.
 */
const CLIENT_SCRIPT = '<script>(()=>{const m=/^prelude-client:(\\{.*\\})$/.exec(window.name);if(!m)return;try{for(const[k,v]of Object.entries(JSON.parse(m[1])))document.documentElement.setAttribute(k,String(v))}catch{}})()</script>';

/**
 * Where a framed page is now (R-w8p), told to the design surface around it,
 * which can't read another origin's frame: an overlay region that's open
 * (#modal, #drawer) at its ko-location, else the page's own address. Posted
 * on each arrival (koda:attached), on Back and when a dialog closes, so
 * Capture opens the page the person has in front of them.
 */
const WHERE_SCRIPT = '<script>(()=>{if(window.parent===window)return;'
  + 'const path=u=>{try{const a=new URL(u,location.href);return a.origin===location.origin?a.pathname+a.search:null}catch{return null}};'
  + 'const open=r=>r&&r.children.length&&r.getAttribute("ko-location")&&(r.closest("dialog")?.open??true);'
  + 'const tell=()=>{const r=["modal","drawer"].map(id=>document.getElementById(id)).find(open);'
  + 'const at=(r&&path(r.getAttribute("ko-location")))||location.pathname+location.search;'
  + 'window.parent.postMessage({type:"prelude:where",at},"*")};'
  + 'const soon=()=>setTimeout(tell,0);'
  + 'document.addEventListener("koda:attached",soon);addEventListener("popstate",soon);document.addEventListener("close",soon,true);'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",tell);else tell()})()</script>';

/**
 * Koda's warnings (0.1.4), told to the design surface around a framed page,
 * which lists them in Prelude's own (_regions.eta): an answer that landed
 * somewhere other than where its request was routed, and Koda's other
 * warnings. A hidden [ko-warnings] is what asks Koda to work the routing
 * advice out, added when the page has none: a design's layouts needn't carry
 * one, since they become the app's, and a production page has none. Each koda:warning is taken here (preventDefault), so a list the page
 * does have stays empty in the frame.
 */
const WARNINGS_SCRIPT = '<script>(()=>{if(window.parent===window)return;'
  + 'const ask=()=>{if(!document.querySelector("[ko-warnings]")){const l=document.createElement("ol");l.hidden=true;l.setAttribute("ko-warnings","");document.body.append(l)}};'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ask);else ask();'
  + 'document.addEventListener("koda:warning",e=>{e.preventDefault();const{code,message,url}=e.detail??{};'
  + 'window.parent.postMessage({type:"prelude:warning",code:String(code??""),message:String(message??""),url:url==null?null:String(url)},"*")})})()</script>';

function withClient(html) {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  return head ? html.slice(0, head.index + head[0].length) + CLIENT_SCRIPT + WHERE_SCRIPT + WARNINGS_SCRIPT + html.slice(head.index + head[0].length) : html;
}

/**
 * Render one of a design's URLs, as its origin would answer it:
 * { status, html }, with a 404 for a route or record that isn't there and a
 * 500 carrying the renderer's error. Used for requests, and for checking every
 * route after the agent's turn.
 */
export async function renderPath(app, { folder, design, designDir, path, query = {}, fragment = false, stateId = null, dataset: given = null }) {
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

  const ext = readHostConfig(folder.path)?.views ?? '.eta';
  const where = viewOf({ folderPath: folder.path, designDir, view: route.view, ext });
  if (where.error) return renderError(where.error);
  const overlay = { views: where.views, template: where.template, data: filterModel(model, route, query) };
  if (fragment) return render(app, folder, { page: overlay, query });

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
    if (pageModel !== undefined) pageModel = filterModel(pageModel, beneath.route, query);
    if (pageModel === undefined) {
      return { status: 404, html: `<p>There's nothing at "${escape(beneath.route.data)}" for the page beneath, in this state.</p>` };
    }
    pageRoute = beneath.route;
    regions[route.in] = { ...overlay, location: path };
  }

  const page = pageRoute === route ? where : viewOf({ folderPath: folder.path, designDir, view: pageRoute.view, ext });
  if (page.error) return renderError(page.error);
  const found = findLayout({ folderPath: folder.path, designDir, shellDir: dirOf('shell'), name: pageRoute.layout, ext })
    ?? { views: BUILT_IN_LAYOUTS, template: './layout', sample: {}, builtIn: true };
  // A design with server events (6e) gets its channel's address, as the app
  // gives its own; a layout opens it from it.layout.live. Without events nothing
  // changes, so no approved screen moves.
  const live = readEvents(designDir).length ? { live: LIVE_PATH } : {};
  const shellData = { ...found.sample, ...live, ...(dataset.layout && typeof dataset.layout === 'object' ? dataset.layout : {}) };
  return render(app, folder, {
    query,
    page: { views: page.views, template: page.template, data: pageRoute === route ? overlay.data : pageModel },
    layout: {
      views: found.views,
      template: found.template,
      builtIn: Boolean(found.builtIn),
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

/**
 * Render a page: through the folder's own design host when prelude.json names
 * one (another stack), else in the sandboxed Eta renderer. { status, html, error? }
 */
async function render(app, folder, job) {
  try {
    const config = app.hosts && readHostConfig(folder.path);
    if (config) {
      const { html, ahead } = await app.hosts.render(folder, config, job);
      return { status: 200, html, ahead };
    }
    return { status: 200, html: await app.renderers.render(folder.path, job) };
  } catch (error) {
    return renderError(String(error.message));
  }
}

function renderError(message) {
  return { status: 500, html: `<pre class="prelude-render-error">${message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`, error: message };
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
 *
 * `renders`, when given, is filled with what a snapshot keeps (snapshots.js):
 * "<state>/<page>" -> html, for each page or fragment as it's shown (an
 * overlay over its page) and each refused form; null for one that failed,
 * which isn't compared with its snapshot (the failure already says it).
 */
export async function checkDesign(app, { folder, design, designDir }, { renders = null, ahead = null } = {}) {
  const routes = readRoutes(designDir);
  const states = listStates(designDir);
  const failures = [];
  for (const state of states.length ? states : [null]) {
    const keep = (name, html) => renders?.set(`${state?.id ?? '_'}/${name}`, html);
    const heard = answer => { for (const member of answer.ahead ?? []) ahead?.add(member); return answer; };
    // Each POST route, against a throwaway copy: a valid post must answer as
    // described, and an empty one must be refused when fields are required.
    for (const { route, path } of samplePaths(readPostRoutes(designDir), readState(designDir, state))) {
      const label = `POST ${path}`;
      // A valid post sends what a record has: the one updated, or, for an add,
      // one already in the list (a new one is like its siblings).
      const at = (dataset) => lookup(dataset, route.at, matchRoute([route], path)?.params ?? {});
      const sibling = list => (Array.isArray(list) ? list.find(item => item && typeof item === 'object') : null);
      const found = route.verb === 'remove' ? null : at(readState(designDir, state));
      // An empty list (a "no notes" state) borrows a sibling from another state.
      const record = route.verb === 'add'
        ? sibling(found) ?? states.map(other => sibling(at(readState(designDir, other)))).find(Boolean) ?? null
        : found;
      const valid = Object.fromEntries([
        ...Object.entries(record && typeof record === 'object' ? record : {}).filter(([k, v]) => !(route.verb === 'add' && k === 'id') && ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)]),
        // A required field is filled in, whatever the record has: a state where
        // it's empty (settings not set up yet) mustn't make the valid post invalid.
        ...route.require.map(name => [name, String(record?.[name] ?? '').trim() ? String(record[name]) : 'Sample']),
      ]);
      const ok = heard(await postPath(app, { folder, design, designDir, path, fields: valid, dataset: structuredClone(readState(designDir, state)) }));
      if (ok.status >= 400) failures.push({ state: state?.title ?? null, path: label, error: ok.error ?? `a filled-in post should be accepted, but it answered ${ok.status}: ${ok.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}` });
      if (route.require.length) {
        const refused = heard(await postPath(app, { folder, design, designDir, path, fields: {}, dataset: structuredClone(readState(designDir, state)) }));
        if (refused.status !== 422) failures.push({ state: state?.title ?? null, path: `${label} (empty)`, error: refused.error ?? `should refuse with 422, answered ${refused.status}` });
        keep(snapshotName(path, { post: true }), refused.status === 422 ? refused.html : null);
      }
    }
    // Each server event (6e), against a throwaway copy: its markup has to
    // render. A state with nothing at its data path skips it.
    for (const event of readEvents(designDir)) {
      const fired = await eventMessages(app, { folder, designDir, event, dataset: structuredClone(readState(designDir, state)) });
      for (const failure of fired.failures.filter(f => f.view)) failures.push({ state: state?.title ?? null, path: `event ${event.name} (${failure.view})`, error: failure.error });
    }
    for (const { route, path, fragment } of samplePaths(routes, readState(designDir, state))) {
      // An overlay is rendered both ways: alone, and over the page beneath.
      for (const alone of route.over ? [true, false] : [fragment]) {
        const answer = heard(await renderPath(app, { folder, design, designDir, path, fragment: alone, stateId: state?.id }));
        if (answer.status === 500) failures.push({ state: state?.title ?? null, path: route.over && alone ? `${path} (alone)` : path, error: answer.error });
        if (!(route.over && alone)) keep(snapshotName(path), answer.status === 200 ? answer.html : null);
      }
      // A route that searches or filters, asked for something nothing matches:
      // its view has to cope with an empty result.
      const params = [...Object.keys(route.search ?? {}), ...Object.keys(route.match ?? {})];
      if (params.length) {
        const query = Object.fromEntries(params.map(param => [param, 'no-such-thing-xyzzy']));
        const answer = await renderPath(app, { folder, design, designDir, path, query, fragment, stateId: state?.id });
        if (answer.status === 500) failures.push({ state: state?.title ?? null, path: `${path}?${new URLSearchParams(query)}`, error: answer.error });
      }
    }
  }
  return failures;
}

/**
 * The whole check of a design: what doesn't render, and what renders
 * differently from its approved snapshots, and which rules point at nothing.
 * { failures, renders, approved, differ: [{ name, diff }], warnings: [text],
 *   ahead: ["Model.member"]: state members a ported view's model doesn't have yet }
 */
export async function reviewDesign(app, ctx) {
  const renders = new Map();
  const ahead = new Set();
  const failures = await checkDesign(app, ctx, { renders, ahead });
  const routes = [...readRoutes(ctx.designDir).map(r => r.pattern), ...readPostRoutes(ctx.designDir).map(r => `POST ${r.pattern}`)];
  const warnings = ruleWarnings(readRules(ctx.designDir), { routes, states: listStates(ctx.designDir) }).map(w => w.warning);
  return { failures, renders, warnings, ahead: [...ahead].sort(), ...compareSnapshots(ctx.designDir, renders) };
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
 * "false" before it, so an unchecked box still says so). A value that isn't a
 * string - a server event's fields, written as JSON (6e) - is already typed.
 */
function typed(value, like) {
  if (typeof value !== 'string') return value;
  if (typeof like === 'number') return value.trim() === '' || Number.isNaN(Number(value)) ? value : Number(value);
  if (typeof like === 'boolean') return ['on', 'true', '1', 'yes'].includes(value.toLowerCase());
  return value;
}

/**
 * A record's own spelling of a field name. A ported form posts what the app's
 * model binder reads ("Borrower.Name"), while the state, written as JSON, has
 * "borrower.name": they're the same field, as they are to the binder.
 */
function keyIn(record, name) {
  if (name in record) return name;
  return Object.keys(record).find(key => key.toLowerCase() === name.toLowerCase()) ?? name;
}

/** A posted field, by name, ignoring case as the app's model binder does. */
const fieldValue = (fields, name) => fields[keyIn(fields, name)];

/** Set each field on a record; "address.city" reaches inside. */
function mergeFields(record, fields) {
  for (const [name, value] of Object.entries(fields)) {
    const steps = name.split('.').filter(Boolean);
    if (steps.length === 0 || steps.some(step => step === '__proto__' || step === 'constructor' || step === 'prototype')) continue;
    let here = record;
    for (const step of steps.slice(0, -1)) {
      const key = keyIn(here, step);
      if (!here[key] || typeof here[key] !== 'object') here[key] = {};
      here = here[key];
    }
    const last = keyIn(here, steps.at(-1));
    here[last] = typed(value, here[last]);
  }
  return record;
}

/** The next id for a list: one more than the largest number (1 for an empty list), or a short random one. */
function nextId(list) {
  const ids = list.map(item => item?.id);
  if (ids.length === 0) return 1;
  if (ids.every(id => Number.isFinite(Number(id)))) return Math.max(...ids.map(Number)) + 1;
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
 * A server event (6e), against `dataset` (changed in place): its change to the
 * data, then what goes down the channel - the event, and its markup rendered
 * from the changed data. { messages, changed, failures: [{ view, error }] }.
 */
export async function eventMessages(app, { folder, designDir, event, dataset }) {
  const ext = readHostConfig(folder.path)?.views ?? '.eta';
  let params = {};
  let changed = false;
  if (event.verb) {
    const applied = applyChange(dataset, { verb: event.verb, at: event.at }, {}, event.with);
    if (applied.missing) return { messages: [], changed: false, failures: [{ view: null, error: `There's nothing at "${applied.missing}" to change.` }] };
    params = applied.params;
    changed = true;
  }
  const failures = [];
  const parts = [];
  for (const part of event.push) {
    if (!part.view) { parts.push(envelope(part.into)); continue; }   // the empty envelope: empty that region
    const where = viewOf({ folderPath: folder.path, designDir, view: part.view, ext });
    const answer = where.error ? renderError(where.error) : await render(app, folder, { page: { views: where.views, template: where.template, data: lookup(dataset, part.data, params) } });
    if (answer.status !== 200) { failures.push({ view: part.view, error: answer.error ?? `It answered ${answer.status}.` }); continue; }
    parts.push(envelope(part.into, answer.html));
  }
  const messages = [...(event.send ? [event.send] : []), ...(parts.length ? [parts.join('\n')] : [])];
  return { messages, changed, failures };
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
  const ext = readHostConfig(folder.path)?.views ?? '.eta';
  const renderView = (view, data) => {
    const where = viewOf({ folderPath: folder.path, designDir, view, ext });
    return where.error ? renderError(where.error) : render(app, folder, { page: { views: where.views, template: where.template, data } });
  };

  // Refused: a required field is empty. Nothing changes; the form comes back
  // with what was typed, and each refused field's message.
  const missing = route.require.filter(name => !String(fieldValue(fields, name) ?? '').trim());
  if (missing.length) {
    const $errors = Object.fromEntries(missing.map(name => [name, 'This is required.']));
    if (!route.form) return { status: 422, html: `<p>Required: ${missing.map(escapeHtml).join(', ')}.</p>`, changed: false };
    const record = route.verb === 'update' ? lookup(dataset, route.at, params) : null;
    const model = mergeFields(structuredClone(record && typeof record === 'object' ? record : {}), fields);
    const answer = await renderView(route.form, { ...model, $errors });
    return { status: answer.status === 200 ? 422 : answer.status, html: answer.html, error: answer.error, ahead: answer.ahead, changed: false };
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
