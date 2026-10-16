// Design hosts for other stacks (plan: step 6c).
//
// A repository whose app renders its own views - another stack, or (step 8)
// the app a first build creates, which is its own design host - names it in a
// committed prelude/prelude.json:
//
//   { "host": { "start": "dotnet run --project App --urls http://localhost:5199",
//               "url": "http://localhost:5199", "views": ".cshtml",
//               "guide": "prelude/HOST.md" } }
//
// The host only renders: Prelude keeps routes, data, forms, overlays and the
// rest, and asks it, over HTTP, to render a view with a model inside a layout
// (the same job the sandboxed Eta renderer does). The contract:
//
//   GET  /__prelude/health   200 once ready
//   POST /__prelude/render   { root, page: { views, template, data },
//                              layout: { views, template, data } | { default: true, data } | null,
//                              regions: { <name>: { views, template, data, location } },
//                              query }
//                            -> 200 text/html, or 500 with the engine's error as text.
//                               A 200 may say x-prelude-ahead: <members>: state members
//                               a typed view's model doesn't have yet (the design is
//                               ahead of the app). Reported, never failed (step 7).
//   GET  <anything else>     the app's own static assets, at their real paths
//
// Paths in a render are relative to the repository (`root`), with forward
// slashes; templates have no extension (the host's is `views`). A layout of
// { default: true } is the host's own minimal layout. Each view sees the query
// as $query, and a refused form's messages as $errors in its data.
//
// A host runs a stack's views as code, unsandboxed, with this person's
// privileges, so it starts only once the person has approved it for this
// folder - approval tied to the exact host settings, asked again when they
// change - and is stopped with Prelude.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join, relative, sep } from 'node:path';

const READY_TIMEOUT_MS = 180000;   // a first `dotnet run` builds before it listens
const RENDER_TIMEOUT_MS = 30000;
const LOG_LIMIT = 20000;

/** The folder's host settings from prelude/prelude.json, or null for the built-in Eta host. */
export function readHostConfig(folderPath) {
  let config;
  try { config = JSON.parse(readFileSync(join(folderPath, 'prelude', 'prelude.json'), 'utf8')); } catch { return null; }
  const host = config?.host;
  if (!host || typeof host.start !== 'string' || typeof host.url !== 'string') return null;
  let url;
  try { url = new URL(host.url); } catch { return null; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;   // hosts on this machine only
  const views = typeof host.views === 'string' && /^\.[a-z0-9]+$/i.test(host.views) ? host.views : '.html';
  const guide = typeof host.guide === 'string' && !host.guide.includes('..') ? host.guide : null;
  const settings = { start: host.start, url: url.origin, views, guide };
  return { ...settings, fingerprint: createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0, 16) };
}

/** A render job's absolute paths, made relative to the repository for the host. */
export function forHost(folderPath, job) {
  const rel = path => relative(folderPath, path).split(sep).join('/');
  const template = name => String(name).replace(/^\.\//, '');
  const part = p => p && { views: rel(p.views), template: template(p.template), data: p.data, ...(p.location ? { location: p.location } : {}) };
  return {
    root: folderPath,
    page: part(job.page),
    layout: job.layout ? (job.layout.builtIn ? { default: true, data: job.layout.data } : part(job.layout)) : null,
    regions: Object.fromEntries(Object.entries(job.regions ?? {}).map(([name, region]) => [name, part(region)])),
    query: job.query ?? {},
  };
}

// A host's url says localhost, which a server may listen on as IPv4, IPv6 or
// both, and Node asks for only one: try IPv4, then IPv6 if nothing's there.
function open(url, { body = null, timeout = RENDER_TIMEOUT_MS, ...options }, onResponse, onError) {
  const attempt = family => {
    const req = request(url, { ...options, timeout, family }, onResponse);
    req.on('timeout', () => req.destroy(new Error(`no answer within ${timeout / 1000}s`)));
    req.on('error', error => {
      if (family === 4 && error.code === 'ECONNREFUSED') attempt(6);
      else onError(error);
    });
    if (body) req.write(body);
    req.end();
  };
  attempt(4);
}

function call(url, { method = 'GET', body = null, timeout = RENDER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    open(url, {
      method,
      body,
      timeout,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }));
    }, reject);
  });
}

export function createHosts({ home }) {
  const approvalsFile = join(home, 'approvals.json');
  const running = new Map();   // folder path -> { child, ready: Promise, log, fingerprint }

  const readApprovals = () => {
    try { return JSON.parse(readFileSync(approvalsFile, 'utf8')); } catch { return {}; }
  };

  const start = (folder, config) => {
    // One host per address: the folder's and a build's share a port, so
    // starting one stops the other.
    for (const [path, other] of running) if (other.url === config.url) stop(path);
    const entry = { log: '', fingerprint: config.fingerprint, url: config.url, child: null, ready: null };
    const append = chunk => { entry.log = (entry.log + chunk).slice(-LOG_LIMIT); };
    append(`$ ${config.start}\n`);
    // The command is the repository's own, run in the repository, as `npm start` would be.
    // PORT is the host's own (from its url), never Prelude's: an app that
    // honours PORT would otherwise try to listen where Prelude already is.
    const port = new URL(config.url).port || '80';
    entry.child = spawn(config.start, { cwd: folder.path, shell: true, windowsHide: true, env: { ...process.env, PRELUDE_HOST: '1', PORT: port } });
    entry.child.stdout.on('data', append);
    entry.child.stderr.on('data', append);
    entry.child.on('exit', code => {
      append(`\n(the host stopped${code === null ? '' : `, exit ${code}`})\n`);
      if (running.get(folder.path) === entry) running.delete(folder.path);
    });
    // Running from now: the wait below asks whether this entry is still the one.
    running.set(folder.path, entry);
    entry.ready = (async () => {
      const until = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < until) {
        if (running.get(folder.path) !== entry) throw new Error(`The design host stopped before it was ready.\n${entry.log.slice(-1500)}`);
        try {
          const answer = await call(`${config.url}/__prelude/health`, { timeout: 2000 });
          if (answer.status === 200) return;
        } catch { /* not listening yet */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`The design host wasn't ready within ${READY_TIMEOUT_MS / 1000}s.\n${entry.log.slice(-1500)}`);
    })();
    entry.ready.catch(() => {});
    return entry;
  };

  const stop = folderPath => {
    const entry = running.get(folderPath);
    if (!entry) return;
    running.delete(folderPath);
    // A shell started it, and `dotnet run` and its kind start the app as a
    // child of their own: take the whole tree down, and wait for it, so a
    // quitting Prelude leaves nothing listening.
    if (process.platform === 'win32' && entry.child.pid) spawnSync('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], { windowsHide: true });
    else entry.child.kill();
  };

  const ensure = (folder, config) => {
    let entry = running.get(folder.path);
    if (entry && entry.fingerprint !== config.fingerprint) { stop(folder.path); entry = null; }
    return (entry ?? start(folder, config)).ready;
  };

  return {
    // A build's worktree is the folder's own branch: approving the folder's
    // host approves the same host there.
    approved(folder, config) {
      const approvals = readApprovals();
      return [folder.id, folder.branch?.parentId].some(id => id && approvals[id] === config.fingerprint);
    },

    approve(folder, config) {
      const all = readApprovals();
      all[folder.id] = config.fingerprint;
      mkdirSync(home, { recursive: true });
      writeFileSync(approvalsFile, JSON.stringify(all, null, 2) + '\n');
    },

    /** Render through the folder's host, starting it if need be: { html, ahead }. Throws with the host's error. */
    async render(folder, config, job) {
      if (!this.approved(folder, config)) {
        throw new Error('This repository’s design host hasn’t been approved yet. It runs the design’s views as code on this machine; approve it in the design bar to start it.');
      }
      await ensure(folder, config);
      const answer = await call(`${config.url}/__prelude/render`, { method: 'POST', body: JSON.stringify(forHost(folder.path, job)) });
      if (answer.status !== 200) throw new Error(answer.body.trim() || `The design host answered ${answer.status}.`);
      const ahead = String(answer.headers['x-prelude-ahead'] ?? '').split(',').map(member => member.trim()).filter(Boolean);
      return { html: answer.body, ahead };
    },

    /** Pass a GET for the app's own assets through to the host, once it's running. */
    async proxy(folder, config, path, res) {
      if (!this.approved(folder, config)) return false;
      try { await ensure(folder, config); } catch { return false; }
      return new Promise(resolve => {
        open(`${config.url}${path}`, {}, answer => {
          const headers = {};
          for (const name of ['content-type', 'content-length', 'cache-control', 'last-modified', 'etag']) {
            if (answer.headers[name]) headers[name] = answer.headers[name];
          }
          res.writeHead(answer.statusCode ?? 502, headers);
          answer.pipe(res);
          answer.on('end', () => resolve(true));
        }, () => resolve(false));
      });
    },

    /** Start a folder's host if it isn't running (stopping another on its url), and wait until it answers. */
    async start(folder, config) {
      if (!this.approved(folder, config)) throw new Error('This repository’s design host hasn’t been approved yet.');
      await ensure(folder, config);
    },

    status(folder, config) {
      const entry = running.get(folder.path);
      return { approved: this.approved(folder, config), running: Boolean(entry), log: entry?.log ?? '' };
    },

    /** Stop a folder's host; the next render starts it again, rebuilding the app. */
    stop(folder) {
      stop(folder.path);
    },

    closeAll() {
      for (const folderPath of [...running.keys()]) stop(folderPath);
    },
  };
}
