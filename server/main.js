// Prelude's server: plain node:http, a handful of routes, views in Eta.
//
// Koda's contract (koda-server-setup): read x-koda-fragment, answer one URL in
// two shapes, and put `Vary: x-koda-fragment` and `x-koda: 1` on every
// response the application produces, including its own refusals.

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appBuildPrompt, buildPrompt, connectAppPrompt, createCliRunner, layoutsBuildPrompt, storyPrompt } from './agent.js';
import { PRELUDE_DIR, createDesign, designIdOf, findDesign, findShell, findSystem, listDesigns } from './designs.js';
import { datasetOf, designHostOf, eventMessages, designOrigin, handleDesignHost, isHosted, listStates, matchRoute, pickable, readPostRoutes, readRoutes, reviewDesign, shellLayoutLinks, unbuiltLayouts } from './host.js';
import { readSnapshots, writeSnapshots } from './snapshots.js';
import { backlogOf } from './backlog.js';
import { ACROSS, acrossChanges, changesOf, createStoryWriter, fingerprintOf, hasStory, readStory, saveStory, storiesBrief } from './build.js';
import { incrementOf } from './increment.js';
import { baselineOf, beforeRemoval, buildable, createBranches, designCommitsSince, gitState, gitUser, mainBranch, remoteOf, removedUnder, textAt } from './branches.js';
import { DEFAULT_STACK, appOf, chooseStack, markExisting } from './app-config.js';
import { createChannels, readEvents } from './events.js';
import { createHosts, readHostConfig } from './hosts.js';
import { createRenderers } from './renderers.js';
import { canonical, cleanPath, createFolders, createReferences, refuseFolder } from './folders.js';
import { createDesignState, designChannel } from './design-state.js';
import { capture } from './capture.js';
import { DICTATION_KEY, SPEECH_MODELS, createDictation } from './dictation.js';
import { createDrafts, draftKey } from './drafts.js';
import { APP_CHANNEL, APP_LIVE, createSeen, homeOf, tell, waitingOf } from './home.js';
import { createLive } from './live.js';
import { createWatches, listScreens, servePreludeFile } from './preview.js';
import { branchesOf, projectOf, referenceId } from './project.js';
import { appendEntry, buildSessions, createSession, listSessions, readEntries, readSession, titleFrom } from './sessions.js';
import { createTurns, designKey, sessionKey, statusMessage } from './turns.js';
import { render, shaped } from './views.js';
import { lastLineOf, notesOf, pixels, presentEntry, reviewOf, rulesOf, sizesAndClients, startedWords, whenWords } from './workspace.js';

const here = dirname(fileURLToPath(import.meta.url));
const kodaDir = dirname(fileURLToPath(import.meta.resolve('@kodalang/core')));
// The Koda package itself (its docs and skills), canonical so the agent's
// --add-dir matches the paths its tools use.
const kodaPackage = canonical(dirname(kodaDir));
const kodaVersion = JSON.parse(readFileSync(join(kodaPackage, 'package.json'), 'utf8')).version;

// Prelude's own design system, in this repository's prelude/ folder: the pages
// ported from a design (Home, a design's page) are written in it, the rest
// still in ds/v1.
const systemDir = (() => {
  const root = dirname(here);
  const system = findSystem(root);
  return system ? join(root, PRELUDE_DIR, ...system.id.split('/'), 'system') : join(here, 'public', 'ds', 'v1');
})();

// ...and its shell's chrome (shell.css), which a design's page renders in.
const shellDir = (() => {
  const root = dirname(here);
  const shell = findShell(root);
  return shell ? join(root, PRELUDE_DIR, ...shell.id.split('/'), 'layouts') : join(here, 'public');
})();

const STATIC = [
  { prefix: '/koda/', dir: kodaDir },
  { prefix: '/ds/', dir: join(here, 'public', 'ds') },
  { prefix: '/system/', dir: systemDir },
  { prefix: '/static/', dir: join(here, 'public') },
  { prefix: '/shell/', dir: shellDir, only: /\.css$/ },
];

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

/** What an image the person attached is served as: only these. */
const IMAGE_SERVED = { 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/gif': 'image/gif', 'image/webp': 'image/webp' };

export function defaultHome() {
  return process.env.PRELUDE_HOME ?? join(homedir(), '.prelude');
}

export function createServer({ home = defaultHome(), runner = createCliRunner(), tidyEvery = 30000 } = {}) {
  const live = createLive();
  // A design's worktree is a folder too (step 9): found by its id like any
  // other, though it isn't in the recent list. The branch is looked up first:
  // a worktree may also have been opened as a plain folder (a step 8 build
  // was), and that record doesn't know it's a branch.
  const opened = createFolders(home);
  const branches = createBranches({ home });
  const app = {
    folders: { ...opened, get: id => branches.folderOf(id) ?? opened.get(id) },
    branches,
    tidied: new Map(),   // folder id -> when its merged branches were last tidied
    tidyEvery,           // how often, at most: tidying fetches from the remote
    references: createReferences(home),
    live,
    // A turn starting or ending changes what needs the person and what's in
    // its project; one that ended while its session was on screen was seen.
    turns: createTurns({ runner, live, onChange: ({ key, finished, watched }) => {
      if (finished && watched) app.seen.mark(key);
      tell(app, { needs: true, projects: true });
    } }),
    seen: createSeen(home),   // the sessions the person has opened (home.js)
    waiting: null,            // how many things wait on the person, once counted (the bar)
    watches: createWatches(),
    renderers: createRenderers({ appRoot: dirname(here) }),
    hosts: createHosts({ home }),
    designs: createDesignState({ live }),
    channels: createChannels(),   // server events' live channels, per design (6e)
    drafts: createDrafts({ home }),          // each session's unsent message
    dictation: createDictation({ home, live }),   // the speech model, on this machine
    stories: createStoryWriter({ runner }),       // the agent writing pages' stories, when asked (build.js)
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
  // Keep idle connections well past a client's own idle timeout (Node's default
  // is 5s): git runs synchronously here, and a request sent on a connection the
  // server is just closing is reset - a form post included, which no browser retries.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  // Renderer processes would outlive the server; stop them with it.
  server.on('close', () => { app.renderers.closeAll(); app.hosts.closeAll(); app.channels.closeAll(); app.dictation.closeAll(); });
  return server;
}

async function handle(req, res, app) {
  const { folders } = app;
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  const fragment = req.headers['x-koda-fragment'] === '1';
  // Every layout gets the app's live channel and the bar's count.
  const layout = () => ({ live: APP_LIVE, needsYou: waitingOf(app) });
  // These pages are still in ds/v1 (shaped's default). Asked for from a page
  // in another document (Home, a design's page), one comes whole, so the
  // browser loads it with its own stylesheets (layoutOfPath).
  const page = (status, view, data, title) => {
    const alone = fragment && askedFromLayout(req, 'ds-v1');
    return send(res, status, shaped(view, data, { fragment: alone, path, title, layout: alone ? {} : layout() }));
  };
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
    return handleDesignHost(req, res, { folders, designs: app.designs, renderers: app.renderers, hosts: app.hosts, channels: app.channels, kodaDir, designKey }, designHost);
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
    for (const { prefix, dir, only } of STATIC) {
      if (!path.startsWith(prefix)) continue;
      if (only && !only.test(path)) return notFoundText();
      return serveFile(res, dir, path.slice(prefix.length));
    }
  }

  // Home: open a folder, or pick a recent one.
  // How the desktop app knows a Prelude server, not something else, is on its port.
  // A length, not chunks, so the shell's few lines of HTTP can read it.
  if (path === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': 7, 'cache-control': 'no-store' });
    return res.end('prelude');
  }

  // The app's live channel: what a page's regions reload on, and the bar's count.
  if (path === APP_LIVE && req.method === 'GET') {
    return app.live.open(APP_CHANNEL, req, res);
  }

  // Home (prelude/landing-page): the page arrives with the recent projects'
  // names, and its two regions read the rest, each on its own.
  //   GET  /                        the page
  //   GET  /loading                 the page as it first arrives, its regions unread
  //   GET  /home/needs-you         what waits on the person, across projects
  //   GET  /home/projects           what's in each project
  //   GET  /open                    Open a project, in the modal over /
  //   POST /folders                 open one: its page, or the form refused
  //   POST /folders/:id/remove      take one off the list; the disk is left alone
  // The window is called Home, so it can be told from Prelude's other pages;
  // /loading and /open keep theirs.
  const homePage = (status, { modal = null, view = 'home/index', title = view === 'home/index' ? 'Home' : 'Prelude' } = {}) => {
    // One URL, two shapes: a Koda region asking for / gets the page alone,
    // unless it asked from a design's page, in another layout (askedFromLayout).
    const alone = fragment && askedFromLayout(req, 'app');
    const body = { fragment: alone, path: '/', title, layout: alone ? {} : layout(), system: true };
    const regions = modal ? { modal: { html: render('./home/_open', modal), location: '/open' } } : {};
    return send(res, status, shaped(view, homeOf(app, { contents: false }), { ...body, regions }));
  };
  // A region Prelude couldn't read: not the app's answer (no x-koda), so Koda
  // keeps what the region had and offers to try again (R-d0y).
  const unreadable = error => {
    console.error(error);
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'vary': 'x-koda-fragment', 'cache-control': 'no-store' });
    return res.end('Prelude couldn’t read your projects.');
  };
  const homePart = (status, view) => {
    let model;
    try { model = homeOf(app, { tidy: folder => tidyFolder(app, folder) }); } catch (error) { return unreadable(error); }
    app.waiting = model.needs.length;
    return send(res, status, shaped(view, model, { fragment, path, title: 'Prelude', layout: fragment ? {} : layout(), system: true }));
  };
  const openForm = (status, data, title) => (fragment ? send(res, status, render('./home/_open', data)) : homePage(status, { modal: data, title }));

  if (path === '/' && req.method === 'GET') return homePage(200);
  if (path === '/loading' && req.method === 'GET') return homePage(200, { view: 'home/loading' });
  if (path === '/home/needs-you' && req.method === 'GET') return homePart(200, 'home/_needs-you');
  if (path === '/home/projects' && req.method === 'GET') return homePart(200, 'home/_projects');
  if (path === '/open' && req.method === 'GET') return openForm(200, { path: '' }, 'Prelude');

  if (path === '/folders' && req.method === 'POST') {
    const form = await readForm(req);
    const value = cleanPath(form.get('path'));
    const error = refuseFolder(value);
    if (error) return openForm(422, { path: value, $errors: { path: error } });
    const folder = folders.open(value);
    tell(app, { needs: true, projects: true });
    return redirect(res, `/f/${folder.id}`);
  }

  const removed = path.match(/^\/folders\/([0-9a-f]+)\/remove$/);
  if (removed && req.method === 'POST') {
    folders.forget(removed[1]);
    tell(app, { needs: true, projects: true });
    return fragment ? homePart(200, 'home/_projects') : redirect(res, '/');
  }

  const forget = path.match(/^\/f\/([0-9a-f]+)\/forget$/);
  if (forget && req.method === 'POST') {
    folders.forget(forget[1]);
    tell(app, { needs: true, projects: true });
    return redirect(res, '/');
  }

  const folderMatch = path.match(/^\/f\/([0-9a-f]+)(\/.*)?$/);
  if (folderMatch) {
    const folder = folders.get(folderMatch[1]);
    if (!folder) return page(404, 'not-found', { what: 'That project isn’t in your recent projects. Open it again from the home page.' }, 'Not found');
    if (refuseFolder(folder.path)) {
      return page(404, 'not-found', { what: `${folder.path} is no longer there.`, forget: `/f/${folder.id}/forget` }, 'Not found');
    }
    const rest = folderMatch[2] ?? '';

    // Step 9: in a git repository, every design works on a branch of its own,
    // in a worktree that is a folder too. `folder.branch` is set in one.
    const repository = !folder.branch && gitState(folder.path) === 'repository';

    // The folder's designs: those on its main branch, and those so far only on
    // their own branches.
    const designsHere = () => {
      const onMain = listDesigns(folder.path);
      if (folder.branch) return onMain;
      const onBranches = app.branches.of(folder.id)
        .filter(entry => !onMain.some(design => design.id === entry.design))
        .map(entry => listDesigns(entry.path).find(design => design.id === entry.design))
        .filter(Boolean);
      return [...onMain, ...onBranches];
    };

    // A project's page (prelude/project-landing-page), on the design system:
    //   GET  /f/<id>                           the page; ?q= and ?stage= filter its designs
    //   GET  /f/<id>/work                      Needs you and In progress, a region
    //   GET  /f/<id>/designs                   the designs, as ?q= and ?stage= leave them, a region
    //   GET  /f/<id>/app                       the app, a region
    //   GET  /f/<id>/designs/new               New design, in the modal over the page
    //   GET  /f/<id>/branches/<b>/publish      Push a branch: asked first, in the modal (R-k4n)
    //   POST /f/<id>/designs                   make one: its page, or the fields refused
    //   POST /f/<id>/branches/<b>/<action>     publish; update, abandon, merge, start: the work
    //   POST /f/<id>/app/build                 start the app build: the app
    //   POST /f/<id>/references                add a folder: the field, and the list
    //   POST /f/<id>/references/<r>/remove     stop reading one: the list
    const here = `/f/${folder.id}`;
    const query = Object.fromEntries(url.searchParams.entries());
    const pageTitle = `${folder.name} · Prelude`;

    // In progress (step 10): a branch's stories - its design's new and changed
    // groups, or those still to build - each with its build session. A group's
    // story is the one the agent wrote, if anyone asked for it (R-w3n).
    const storiesOf = (entry, design) => {
      const dir = join(entry.path, PRELUDE_DIR, ...design.id.split('/'));
      if (!isHosted(dir) || !buildsPages(design)) return [];
      const built = buildSessions(dir);
      return groupsOf(app, { entry, design, dir }).groups.filter(group => group.kind !== 'unchanged').map(group => {
        const session = built.get(group.key);
        return {
          title: group.title,
          kind: group.kind === 'changed' ? 'changed' : 'new',
          state: !group.toBuild ? 'built' : entry.building?.group === group.key ? 'building' : 'to-build',
          summary: group.change?.summary ?? '',
          story: writtenStory(dir, group),
          session: session ? `/f/${entry.id}/d/${design.id}/sessions/${session.id}` : null,
        };
      });
    };
    const helpers = { branchOf: (entry, design) => branchState(app, entry, design), storiesOf };
    /** The page's model (project.js), with the request's query for its views. */
    const projectModel = (options = {}) => ({ ...projectOf(app, folder, { ...helpers, query, ...options }), $query: query });

    // One URL, two shapes: a Koda region asking for the page gets it alone,
    // unless it asked from a page in another layout (askedFromLayout). A cold
    // load of an overlay is the page, with the overlay in its region.
    const projectPage = (status, { model = projectModel(), regions = {} } = {}) => {
      const alone = fragment && askedFromLayout(req, 'app') && !Object.keys(regions).length;
      const at = req.method === 'GET' && rest === '' ? `${path}${url.search}` : here;
      return send(res, status, shaped('projects/page', model, { fragment: alone, path: at, title: pageTitle, layout: alone ? {} : layout(), regions, system: true }));
    };
    // A region of the page; one Prelude couldn't read keeps what it had (unreadable).
    const projectPart = (status, view, options = {}) => {
      let model;
      try { model = projectModel(options); } catch (error) { return unreadable(error); }
      return send(res, status, shaped(view, model, { fragment, path: `${path}${url.search}`, title: pageTitle, layout: fragment ? {} : layout(), system: true }));
    };
    const overlay = (status, html) => (fragment ? send(res, status, html) : projectPage(status, { regions: { modal: { html, location: `${path}${url.search}` } } }));
    const envelope = (into, html = '') => `<div ko-into="${into}">${html}</div>`;

    const tidy = () => { if (repository) tidyFolder(app, folder); };

    // A design's branch, made if it has none; for a folder that isn't a
    // repository yet, making one makes it one. { entry, worktree } or { error }.
    const branchFor = (designId, title) => {
      const made = app.branches.ensure({ folder, designId, title });
      return made.error ? made : { entry: made.entry, worktree: app.folders.get(made.entry.id) };
    };

    // A design's branch: push it for a pull request (asked first), bring main
    // into it or abandon that, merge it into main here, or start its app.
    // Each answers with the work, as the branch's forms ask; a push, which
    // asks in the modal, with the page and a notice.
    const branchMatch = rest.match(/^\/branches\/([0-9a-f]+)\/(publish|update|abandon|merge|start)$/);
    if (branchMatch && !folder.branch && (req.method === 'POST' || (req.method === 'GET' && branchMatch[2] === 'publish'))) {
      const entry = app.folders.get(branchMatch[1])?.branch;
      if (!entry || entry.parentId !== folder.id) return redirect(res, here);
      const action = branchMatch[2];
      const branchNow = () => branchesOf(app, folder, helpers).find(item => item.id === entry.id) ?? null;
      // Pushing is always asked first, saying which branch goes to which
      // remote; nothing is pushed until the person says yes (R-k4n).
      const ask = () => {
        const branch = branchNow();
        return branch ? overlay(200, render('./projects/_publish', branch)) : redirect(res, here);
      };
      if (req.method === 'GET') return ask();

      const form = await readForm(req);
      const design = listDesigns(entry.path).find(candidate => candidate.id === entry.design) ?? { id: entry.design, title: entry.design };
      // The work, with why finishing the branch failed beside it, where the
      // person clicked, and logged: the top of a long page is easily out of sight.
      const work = (status, failed = null) => {
        if (failed) console.error(`Finishing ${entry.branch} failed: ${failed}`);
        const finishError = failed ? { id: entry.id, message: failed } : null;
        if (!fragment) return failed ? projectPage(status, { model: projectModel({ finishError }) }) : redirect(res, here);
        return projectPart(status, 'projects/_work', { parts: { designs: false }, finishError });
      };

      // Merged, the branch leaves In progress and its design is under Designs again (R-2hx).
      if (action === 'merge') {
        const merged = app.branches.merge(entry, `Merge ${entry.branch}: ${design.title} (merged by Prelude)`);
        if (merged.error) return work(409, merged.error);
        app.tidied.delete(folder.id);
        tidy();
        tell(app, { needs: true, projects: true });
        return work(200);
      }
      if (action === 'update') {
        const updated = app.branches.update(entry);
        noteOnBranch(entry, updated.error
          ? updated.error
          : updated.clashes
          ? `${updated.from} is half brought into this branch: ${updated.clashes.length === 1 ? '1 file clashes' : `${updated.clashes.length} files clash`} (${updated.clashes.join(', ')}), left with git's conflict markers. The agent resolves them with your next message; nothing is committed until it has. Or abandon the update.`
          : updated.files.length ? `Brought ${updated.from} into this branch: ${updated.files.length} ${updated.files.length === 1 ? 'file' : 'files'} came in. The agent is told with your next message.` : `${updated.from} had nothing new for this branch.`, Boolean(updated.error));
        tell(app, { projects: true });
        return work(updated.error ? 409 : 200, updated.error ?? null);
      }
      if (action === 'abandon') {
        const abandoned = app.branches.abandon(entry);
        const said = abandoned ? `Abandoned the update from ${mainOf(folder)}: the branch is as it was before it.` : 'git couldn’t abandon the update.';
        noteOnBranch(entry, said, !abandoned);
        tell(app, { projects: true });
        return work(abandoned ? 200 : 409, abandoned ? null : said);
      }
      // The app on this branch (10.7): its host started here, stopping
      // whichever branch had its url. One that fails to start says why in
      // the design bar's log.
      if (action === 'start') {
        const worktree = app.folders.get(entry.id);
        const config = readHostConfig(entry.path);
        if (worktree && config && app.hosts.approved(worktree, config)) {
          try { await app.hosts.start(worktree, config); } catch { /* its log says why */ }
        }
        tell(app, { projects: true });
        return work(200);
      }

      // Publish: push and open a pull request, once the person has said yes.
      if (form.get('confirm') !== 'yes') return ask();
      const published = app.branches.publish(entry, { title: `${design.title} (designed and built with Prelude)`, body: pullRequestBody(app, entry, design) });
      if (published.error) console.error(`Finishing ${entry.branch} failed: ${published.error}`);
      else {
        noteOnBranch(entry, published.pr ? `Pushed ${entry.branch} and opened a pull request: ${published.pr}` : `Pushed ${entry.branch}. Open the pull request here: ${published.compare ?? 'on your Git server'}`);
        tell(app, { needs: true, projects: true });
      }
      // Pushed: the modal closes, the page shows the pull request open, and
      // the notice says so. A failed push stays beside its branch.
      const status = published.error ? 409 : 200;
      const model = projectModel(published.error ? { finishError: { id: entry.id, message: published.error } } : {});
      const pushed = !published.error && model.inProgress.find(item => item.id === entry.id);
      const notice = pushed ? render('./projects/_pushed', pushed) : '';
      if (!fragment) return projectPage(status, { model, regions: notice ? { notice: { html: notice, location: path } } : {} });
      return send(res, status, [envelope('modal?'), envelope('workspace', render('./projects/page', model)), ...(notice ? [envelope('notice?', notice)] : [])].join('\n'));
    }

    // Build the app (step 8): in a build session on the folder's shell's
    // branch, the shell made if there isn't one. Starting it settles the stack
    // if nobody had. It answers with the app, now being built; one that
    // couldn't start says why in the notice.
    if (rest === '/app/build' && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      const answer = (status, appError = null) => {
        if (!fragment) return appError ? projectPage(status, { model: projectModel({ appError }) }) : redirect(res, `${here}#app`);
        const html = render('./projects/_app', projectModel({ parts: { work: false, designs: false } }));
        return send(res, status, appError ? `${html}\n${envelope('notice?', `<p role="alert">${escapeHtml(appError)}</p>`)}` : html);
      };
      let state = appOf(folder.path);
      // An app the project already has is connected, not built (8b).
      if (['yes', 'true'].includes(String(form.get('existing') ?? '')) && !state.built) state = markExisting(folder.path);
      if (!state.stack && !state.existing) state = chooseStack(folder.path, String(form.get('stack') ?? '').trim() || DEFAULT_STACK);
      if (state.built) return answer(200);
      let shell = designsHere().find(design => design.kind === 'shell');
      let made;
      if (!shell) {
        made = branchFor('app-shell', 'App shell');
        if (made.error) return answer(409, made.error);
        const created = createDesign(made.entry.path, { title: 'App shell', kind: 'shell' });
        if (created.errors) return answer(409, Object.values(created.errors)[0]);
        app.branches.commit(made.entry, 'App shell: a new design (committed by Prelude)');
        shell = created.design;
      } else {
        made = branchFor(shell.id, shell.title);
        if (made.error) return answer(409, made.error);
      }
      const started = await startedBuild({ req, app, folder: made.worktree, designId: shell.id, groupKey: APP_GROUP.key });
      return started.error ? answer(409, started.error) : answer(200);
    }

    if (rest === '' && req.method === 'GET') {
      folders.open(folder.path);
      tidy();
      return projectPage(200);
    }

    // The page's regions. The work's every-five-minutes read tidies what was
    // merged on the Git server, which says so down the channel (R-8dz).
    if (rest === '/work' && req.method === 'GET') {
      tidy();
      return projectPart(200, 'projects/_work', { parts: { designs: false } });
    }
    if (rest === '/designs' && req.method === 'GET') return projectPart(200, 'projects/_designs', { parts: { work: false } });
    if (rest === '/app' && req.method === 'GET') return projectPart(200, 'projects/_app', { parts: { work: false, designs: false } });

    // New design, in the modal; ?kind= picks the design system or the shell.
    if (rest === '/designs/new' && req.method === 'GET' && !folder.branch) {
      return overlay(200, render('./projects/_new-design', projectModel()));
    }

    // Approving the repository's design host: it runs the design's views as
    // code on this machine, so it starts only once the person says so. In a
    // design's worktree, the approval is the folder's, so every branch has it.
    if (rest === '/host/approve' && req.method === 'POST') {
      const config = readHostConfig(folder.path);
      const form = await readForm(req);
      if (config) app.hosts.approve(folder.branch ? { id: folder.branch.parentId } : folder, config);
      const back = String(form.get('back') ?? '');
      return redirect(res, back.startsWith(`/f/${folder.id}`) ? back : `/f/${folder.id}`);
    }

    // The app on this branch (10.7): start its host here, stopping whichever
    // branch had its url, and come back once it answers. A host that fails
    // to start says why in the design bar's log.
    if (rest === '/host/start' && req.method === 'POST') {
      const config = readHostConfig(folder.path);
      const form = await readForm(req);
      if (config && app.hosts.approved(folder, config)) {
        try { await app.hosts.start(folder, config); } catch { /* its log says why */ }
      }
      const back = String(form.get('back') ?? '');
      return redirect(res, /^\/f\/[^/]/.test(back) ? back : `/f/${folder.id}`);
    }

    // Open the app: a link on Prelude's own origin, so the desktop app opens
    // it in the system browser, which follows this to the host's url.
    if (rest === '/host/open' && req.method === 'GET') {
      const config = readHostConfig(folder.path);
      return redirect(res, config ? `${config.url}/` : `/f/${folder.id}`);
    }

    // Reference folders: what else the agent may read while working here.
    // Added, the field comes back empty and the list with it; refused, the
    // field comes back with what was typed and why.
    if (rest === '/references' && req.method === 'POST') {
      const value = cleanPath((await readForm(req)).get('path'));
      const added = app.references.add(folder, value);
      if (added.error) {
        const field = { path: value, $errors: { path: added.error } };
        if (fragment) return send(res, 422, render('./projects/_reference-field', field));
        return projectPage(422, { model: { ...projectModel(), $reference: field } });
      }
      if (!fragment) return redirect(res, `${here}#reading`);
      const model = projectModel({ parts: { work: false, designs: false } });
      return send(res, 200, `${render('./projects/_reference-field', model)}\n${envelope('references', render('./projects/_references', model))}`);
    }

    const referenceMatch = rest.match(/^\/references\/([0-9a-f]+)\/remove$/);
    if (referenceMatch && req.method === 'POST') {
      const reference = app.references.of(folder.id).find(candidate => referenceId(candidate.path) === referenceMatch[1]);
      if (reference) app.references.remove(folder.id, reference.path);
      if (!fragment) return redirect(res, `${here}#reading`);
      return send(res, 200, render('./projects/_references', projectModel({ parts: { work: false, designs: false } })));
    }

    if (rest === '/designs' && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      const input = { title: String(form.get('title') ?? ''), area: String(form.get('area') ?? ''), kind: ['system', 'shell'].includes(form.get('kind')) ? form.get('kind') : 'design' };
      // Refused, the fields come back alone, with what was typed and why; on
      // a cold load, in New design over the page. The fields hold only the
      // title and the area, so a refusal of the kind (the app comes first, or
      // the project has one already) is said under the title (NOTES.md).
      const refused = (status, errors) => {
        const fields = { title: input.title, area: input.area, $errors: errors.kind && !errors.title ? { ...errors, title: errors.kind } : errors };
        if (fragment) return send(res, status, render('./projects/_new-design-fields', fields));
        const model = projectModel();
        const html = render('./projects/_new-design', { ...model, $query: { kind: input.kind }, $fields: fields });
        return projectPage(status, { model, regions: { modal: { html, location: `${here}/designs/new` } } });
      };
      // A design needs a title; refused, nothing else changes.
      if (!input.title.trim()) return refused(422, { title: 'Give the design a title.' });
      // Designs of views are written in the app's language (step 8). The first
      // one settles the stack: the default, or one described. A described
      // stack's app, with its design host, is built before any design of views.
      // The design system is plain HTML, so it needs no stack.
      if (input.kind !== 'system') {
        let state = appOf(folder.path);
        if (form.get('existing') === 'yes' && !state.stack && !state.built) state = markExisting(folder.path);
        if (!state.stack && !state.existing) state = chooseStack(folder.path, String(form.get('stack') ?? '').trim() || DEFAULT_STACK);
        if (state.existing && !state.built) {
          return refused(409, { kind: 'Designs here are written as the app’s own views, so the app this project already has is connected first. Connect the app, under The app.' });
        }
        if (state.custom && !state.built) {
          return refused(409, { kind: `Designs here will be written in ${state.stack}, so its app is built first, with a design host. Start the app build, under The app.` });
        }
      }
      // In a repository, a new design is made on its own branch.
      if (repository) {
        const id = designIdOf(input);
        const existing = designsHere();
        if (input.kind !== 'design') {
          const same = existing.find(design => design.kind === input.kind);
          if (same) return refused(422, { kind: `This project already has ${input.kind === 'system' ? 'a design system' : 'an app shell'}: "${same.title}".` });
        }
        if (!id.split('/').at(-1)) return refused(422, { title: 'The title needs at least one letter or digit.' });
        if (existing.some(design => design.id === id)) return refused(422, { title: `prelude/${id} already exists.` });
        const made = branchFor(id, input.title.trim());
        if (made.error) return refused(409, { kind: made.error });
        const result = createDesign(made.entry.path, input);
        if (result.errors) return refused(422, result.errors);
        app.branches.commit(made.entry, `${result.design.title}: a new design (committed by Prelude)`);
        tell(app, { projects: true });
        return redirect(res, `/f/${made.entry.id}/d/${result.design.id}`);
      }
      const result = createDesign(folder.path, input);
      if (result.errors) return refused(422, result.errors);
      tell(app, { projects: true });
      return redirect(res, `/f/${folder.id}/d/${result.design.id}`);
    }

    if (rest.startsWith('/d/')) {
      const segments = rest.slice(3).split('/');
      // In a repository, a design is worked on in its branch's worktree: a page
      // there is moved to it, and anything posted is answered there, the branch
      // made first if the design has none yet. Starting a build in a folder
      // that isn't a repository makes it one, and the design's branch with it.
      const startsBuild = req.method === 'POST' && segments.at(-1) === 'builds';
      if (repository || (!folder.branch && startsBuild && buildable(folder.path))) {
        const onMain = findDesign(folder.path, segments);
        const onBranch = !onMain && app.branches.of(folder.id)
          .map(entry => ({ entry, found: findDesign(entry.path, segments) }))
          .find(({ entry, found }) => found?.design.id === entry.design);
        const design = onMain?.design ?? onBranch?.found?.design;
        if (design) {
          let entry = app.branches.forDesign(folder.id, design.id);
          if (!entry && req.method === 'POST') {
            const made = branchFor(design.id, design.title);
            if (made.error) return page(409, 'not-found', { what: made.error }, 'Couldn’t make the design’s branch');
            entry = made.entry;
          }
          if (entry) {
            if (req.method === 'GET') return redirect(res, `/f/${entry.id}${rest}${url.search}`);
            const worktree = app.folders.get(entry.id);
            const found = findDesign(worktree.path, segments);
            if (found) return handleDesign({ req, res, url, page, app, folder: worktree, ...found });
          }
        }
      }
      const found = findDesign(folder.path, segments);
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
// The app build's group (step 8): not a page of a design, but the app itself,
// built in a session of the folder's shell, since the shell is the app's frame.
const APP_GROUP = { key: '@app', slug: 'app', title: 'The app', routes: [], posts: [], rules: [] };

// The shell's layouts the app hasn't got yet, built from the shell's Build page (8c).
const LAYOUTS_GROUP = { key: '@layouts', slug: 'layouts', title: 'The shell’s layouts', routes: [], posts: [], rules: [], events: [] };

/** The shell's layouts in a folder (a branch's worktree): { id, dir, unbuilt: [name], links }, or null with no shell. */
function shellLayoutsOf(folderPath) {
  const shell = findShell(folderPath);
  if (!shell) return null;
  const dir = join(folderPath, PRELUDE_DIR, ...shell.id.split('/'));
  return { id: shell.id, dir, unbuilt: unbuiltLayouts(dir, readHostConfig(folderPath)?.views ?? '.eta'), links: shellLayoutLinks(dir) };
}

/** The layouts a group's pages render in (overlays render over their page): [name]. */
const layoutsOfGroup = group => [...new Set(group.routes.filter(route => !route.over).map(route => route.layout || 'app'))];

/**
 * A design's branch, as the pages that list it show it (step 9): its links,
 * what it's doing, what its last check said - 'passing', 'failing',
 * 'waiting' (its design host wants approving) or 'unchecked' - and where it
 * stands against main (behind, merged, what it changes outside its design).
 */
function branchState(app, entry, design = null) {
  const dir = join(entry.path, PRELUDE_DIR, ...entry.design.split('/'));
  let last = null;
  for (const session of listSessions(dir)) {
    for (const item of readEntries(dir, session.id)) {
      const counts = item.type === 'check' || (item.type === 'note' && /needs your approval/.test(item.text ?? ''));
      if (counts && (!last || item.at > last.at)) last = item;
    }
  }
  const check = !last ? 'unchecked' : last.type === 'note' ? 'waiting' : last.failures.length ? 'failing' : 'passing';
  let status = { into: 'main', merged: false, worked: false, behind: 0, ahead: 0, alsoChanges: [] };
  try { status = app.branches.status(entry); } catch { /* git couldn't say */ }
  return {
    ...entry, ...status, check, failures: last?.failures?.length ?? 0,
    title: design?.title ?? entry.design,
    url: `/f/${entry.id}/d/${entry.design}`,
    remote: Boolean(remoteOf(entry.path)),
    running: appRunning(app, entry),
    merging: (() => { try { return app.branches.merging(entry); } catch { return null; } })(),
  };
}

/**
 * The app on a branch (10.7), once it's built and has a design host: the
 * host's url is the app itself, with its own data, when it's running from
 * this branch's worktree. One url serves one branch at a time. Else null.
 */
function appRunning(app, entry) {
  const config = readHostConfig(entry.path);
  if (!config || !appOf(entry.path).built) return null;
  const status = app.hosts.status({ id: entry.id, path: entry.path, branch: entry }, config);
  return {
    url: config.url,
    running: status.running,
    approved: status.approved,
    open: `/f/${entry.id}/host/open`,
    start: `/f/${entry.id}/host/start`,
  };
}

/** A note in a design's newest session on its branch: what Prelude did to the branch. */
function noteOnBranch(entry, text, failed = false) {
  const dir = join(entry.path, PRELUDE_DIR, ...entry.design.split('/'));
  const newest = listSessions(dir)[0];
  if (newest) appendEntry(dir, newest.id, { type: 'note', text, ...(failed ? { failed: true } : {}) });
}

const mainOf = folder => mainBranch(folder.path);

/**
 * The document a Prelude page renders in, by its path: what has to be the
 * same for Koda to swap one page into another's main region.
 *   'app'     the app layout with the design system: Home, a project's page
 *             (and its regions and overlays), a design's page, Build
 *   'ds-v1'   the app layout with the older ds/v1 stylesheets, for the pages
 *             not moved onto the design system yet (the rest)
 *   'window'  a design's pop-out, a window of its own
 * A page moved onto the design system leaves the ds-v1 list.
 */
function layoutOfPath(pathname) {
  if (pathname === '/' || pathname === '/open') return 'app';
  if (/^\/f\/[0-9a-f]+(\/(work|app|designs|designs\/new|branches\/[0-9a-f]+\/publish))?\/?$/.test(pathname)) return 'app';
  if (!/^\/f\/[0-9a-f]+\/d\//.test(pathname)) return 'ds-v1';
  return pathname.endsWith('/window') ? 'window' : 'app';
}

/**
 * Whether a Koda fragment request came from a page in this layout, by its
 * Referer. A fragment only fits the layout it was made for: swapped into
 * another's main region it would miss that layout's stylesheet and frame.
 * Koda hands a whole document to the browser, which loads it as a page, so a
 * request from another layout is answered whole. Without a Referer, it's
 * taken as the same layout, as before.
 */
function askedFromLayout(req, layout) {
  let from;
  try { from = new URL(req.headers.referer); } catch { return true; }
  if (from.host !== req.headers.host) return true;
  return layoutOfPath(from.pathname) === layout;
}

/**
 * Remove the worktrees and branches of a folder's designs merged into main
 * (here, or by a pull request on the server), at most every 30 seconds per
 * folder. A branch tidied away changes what needs the person (R-w2k).
 */
function tidyFolder(app, folder) {
  if (folder.branch || Date.now() - (app.tidied.get(folder.id) ?? 0) < app.tidyEvery) return;
  if (gitState(folder.path) !== 'repository') return;
  app.tidied.set(folder.id, Date.now());
  try {
    const notes = app.branches.tidy(folder, { beforeRemove: entry => app.hosts.stop({ path: entry.path }) });
    if (notes.length) tell(app, { needs: true, projects: true });
  } catch { /* git couldn't say: try again next time */ }
}

/** Whether a design has pages to build: a feature, or the shell's own (its Settings, say). */
const buildsPages = design => design.kind === 'design' || design.kind === 'shell';

/** A shell's gallery: the pages under its views' gallery/, showing its layouts. Never built. */
const isGallery = (design, group) => design.kind === 'shell' && (!group.page || group.page.view.startsWith('gallery/'));

/**
 * A design's groups as its Build page and the folder's "In progress" show
 * them (steps 7 and 10, prelude/build), each with:
 *   kind        'new' (not on main), 'changed' (the app has the page, and the
 *               design changes it), 'to build' (on main, not built yet) or
 *               'unchanged' (built, and no change)
 *   change      the increment (increment.js), on a branch
 *   incremental whether only the increment is new to the app: the app had the
 *               page as main has it. Else the whole page is, less what's built (R-7qd)
 *   changes     what it changes in the app, in plain lines (build.js)
 *   fingerprint what its story would be written from, to tell when one's out of date
 *   toBuild     whether a build session is still due: a changed group is built
 *               once a build of it has finished since its last design change
 * Design-wide rules and events are a group of their own, Across the design.
 * { groups, designWide, events, shared }.
 */
function groupsOf(app, { entry, design, dir }) {
  const backlog = backlogOf(dir);
  const groups = backlog.groups.filter(group => !isGallery(design, group));
  const { designWide } = backlog;
  const states = listStates(dir);
  const stateTitle = id => states.find(state => state.id === id)?.title ?? id;
  const titles = new Map(readRoutes(dir).map(route => [route.pattern, route.title]));
  const folderPath = join(dir, ...design.id.split('/').map(() => '..'), '..');
  const ext = readHostConfig(folderPath)?.views ?? '.eta';
  let increment = null;
  let shared = [];
  let repo = null;
  if (entry) {
    try {
      repo = entry.repo ?? app.folders.get(entry.parentId)?.path ?? null;
      const base = repo && baselineOf(repo, entry.branch);
      if (base) increment = incrementOf({ repo, base, designId: design.id, designDir: dir, ext });
      shared = app.branches.status(entry).alsoChanges;
    } catch { /* git couldn't say: whole pages, as without a branch */ }
  }
  // Built as of a build's commit, and the design not changed since (step 10).
  const builtSince = key => {
    const builtAt = entry?.built?.[key];
    return Boolean(builtAt && repo && designCommitsSince(repo, builtAt, entry.branch, design.id).length === 0);
  };
  const described = (group, changes) => ({ ...group, changes, fingerprint: fingerprintOf({ dir, group, changes, ext }) });
  // The shell's layouts (8c): once the app exists, the ones it hasn't got are
  // the shell's first group, and a page that renders in one waits for it.
  const layouts = appOf(folderPath).built ? shellLayoutsOf(folderPath) : null;
  const layoutsGroup = design.kind === 'shell' && layouts?.unbuilt.length
    ? [described({ ...LAYOUTS_GROUP, layouts: layouts.unbuilt, kind: 'to build', change: null, incremental: false, toBuild: true, built: false, needsLayouts: [] },
      layouts.unbuilt.map(name => ({ icon: 'screen', text: `The shell’s “${name}” layout` })))]
    : [];
  const pages = groups.map(group => {
    const change = increment?.groups.get(group.key) ?? null;
    const changed = change?.status === 'changed';
    const incremental = Boolean(changed && change.builtBefore);
    // A redesign of a page the app has is a change to it, not a new page (R-7qd).
    const kind = incremental || (group.page?.from && !group.built) ? 'changed'
      : change?.status === 'new' ? 'new'
      : group.built && !changed ? 'unchanged' : 'to build';
    const toBuild = changed ? !(group.built && builtSince(group.key)) : !group.built;
    const needsLayouts = layouts ? layoutsOfGroup(group).filter(name => layouts.unbuilt.includes(name)) : [];
    const changes = changesOf({ group, change: incremental ? change : null, states, titles, stateTitle });
    return described({ ...group, kind, change, incremental, toBuild, needsLayouts }, changes);
  });
  // Across the design: the design-wide rules the app hasn't got, and the
  // server events no page claims, so no page's story repeats them (R-c9r).
  const wide = acrossChanges({ wide: increment?.designWide ?? null, rules: designWide, events: backlog.events ?? [] });
  const acrossDue = designWide.some(rule => rule.proposed) || (wide.some(line => line.icon === 'run') && !builtSince(ACROSS.key));
  const across = wide.length
    ? [described({ ...ACROSS, page: null, routes: [], posts: [], rules: designWide, events: backlog.events ?? [], kind: increment && !increment.designNew ? 'changed' : 'new', change: null, incremental: false, toBuild: acrossDue, built: !acrossDue, needsLayouts: [] }, wide)]
    : [];
  return {
    designWide,
    events: backlog.events,   // server events no page claims (6e)
    shared,
    groups: [...layoutsGroup, ...pages, ...across],
  };
}

/** A group's written stories as one Markdown text for a tracker, or '' with none (R-w3n). */
const writtenStory = (dir, group) => (readStory(dir, group.slug, { url: '', fingerprint: group.fingerprint, changes: group.changes })?.stories ?? [])
  .map(story => story.markdown).join('\n\n---\n\n');

/** A pull request's description: what the branch holds, from its design. */
function pullRequestBody(app, entry, design) {
  const dir = join(entry.path, PRELUDE_DIR, ...entry.design.split('/'));
  const designPath = `${PRELUDE_DIR}/${entry.design}`;
  const lines = [`Designed${isHosted(dir) ? ' and built' : ''} with Prelude on \`${entry.branch}\`. The design is in \`${designPath}/\`: its views, routes and states are the specification, and its approved screens are in \`${designPath}/snapshots/\`.`, ''];
  if (isHosted(dir)) {
    const { groups } = backlogOf(dir);
    const built = groups.filter(group => group.built).map(group => group.title);
    const left = groups.filter(group => !group.built).map(group => group.title);
    if (built.length) lines.push(`Built: ${built.join(', ')}.`);
    if (left.length) lines.push(`Still the design's own (not built yet): ${left.join(', ')}.`);
    lines.push('');
  }
  let also = [];
  try { also = app.branches.status(entry).alsoChanges; } catch { /* none */ }
  if (also.length) lines.push('Also changes, outside the design:', ...also.map(path => `- \`${path}\``), '');
  lines.push('Run `npm run check` (Prelude) to render every page in every state and compare it with the approved screens.');
  return lines.join('\n');
}

/**
 * Start building one group of a design on its branch (`folder` is the
 * design's worktree): the build route answers the request, as if the person
 * had pressed "Start a build session" on the design's Build page.
 */
async function startGroupBuild({ req, res, page, app, folder, designId, groupKey }) {
  const found = findDesign(folder.path, designId.split('/'));
  const buildsUrl = `/f/${folder.id}/d/${designId}/builds`;
  const body = Readable.from([Buffer.from(new URLSearchParams({ group: groupKey }).toString())]);
  const first = Object.assign(body, { method: 'POST', url: buildsUrl, headers: { ...req.headers, 'content-type': 'application/x-www-form-urlencoded' } });
  return handleDesign({ req: first, res, url: new URL(buildsUrl, 'http://localhost'), page, app, folder, ...found, rest: ['builds'] });
}

/**
 * Start building a group as startGroupBuild does, for a page that answers
 * with something of its own (the project page's app): { ok } once its build
 * session has started, or { error } saying why it couldn't.
 */
async function startedBuild({ req, app, folder, designId, groupKey }) {
  const answer = { status: 0, error: null };
  const res = { headersSent: false, writeHead(status) { answer.status = status; }, end() {} };
  const page = (status, view, data) => { answer.status = status; answer.error = data?.error ?? null; };
  await startGroupBuild({ req, res, page, app, folder, designId, groupKey });
  return answer.status === 303 ? { ok: true } : { error: answer.error ?? 'The app build couldn’t start.' };
}

const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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
  // 'design' (the design's views and states) or 'app' (the built app, 10.8).
  const modeOf = value => (value === 'app' ? 'app' : 'design');
  // The app built here, as the design surface shows it: its url, and whether
  // it's running from this folder (one url serves one branch at a time). Null
  // until the app exists here.
  const appHere = () => {
    const config = readHostConfig(folder.path);
    if (!config || !appOf(folder.path).built) return null;
    const status = app.hosts.status(folder, config);
    return { url: config.url, running: status.running, approved: status.approved, start: `/f/${folder.id}/host/start` };
  };
  // The folder this design's folder belongs to: itself, or (in a design's
  // worktree) the repository it's a branch of. What the agent may read, and
  // where finishing happens, are the folder's.
  const parentId = folder.branch?.parentId ?? folder.id;
  const entry = folder.branch?.design === design.id ? folder.branch : null;

  // --- the design page's model (prelude/design-workspace; server/workspace.js)

  const routes = hosted ? readRoutes(dir) : [];
  const states = hosted ? listStates(dir) : [];
  const stateOn = () => states.find(s => s.id === designs.state(dKey)) ?? states[0] ?? null;
  const datasetFor = state => datasetOf(app, dKey, dir, state);
  const context = { base, routes, states, datasetOf: datasetFor };
  // How the pages show transcript entries, pushed or rendered.
  const view = { present: item => presentEntry(item, context), base };

  // A window's way of looking at the design (Design or App, its size and its
  // client), from a form's fields or a URL's query: the design's forms post
  // surface.view and the like; anything else may say view, mode, size, client.
  const lookingOf = get => ({
    view: viewOf(get('surface.view') ?? get('view')),
    mode: modeOf(get('surface.mode') ?? get('mode')),
    size: String(get('surface.size') ?? get('size') ?? 'fit'),
    client: get('surface.client') ?? get('client') ?? null,
  });
  const fromForm = form => lookingOf(name => (form.has(name) ? String(form.get(name)) : null));
  const fromQuery = () => lookingOf(name => url.searchParams.get(name));

  /**
   * The design surface, as one window shows it. The page and the state on
   * show are the design's (R-c2m); Design or App, the size and the client
   * are the window's. Sizes and clients are the shell's (R-h9x), the custom
   * size the design's. `showing` takes the "a state's file changed" notice,
   * which is said once.
   */
  const surfaceOf = ({ view: shown = 'inline', mode = 'design', size = 'fit', client = null, notice = null, showing = false } = {}) => {
    const { sizes, clients } = sizesAndClients(folder.path);
    const custom = designs.custom(dKey);
    const built = hosted ? appHere() : null;
    const reset = showing ? designs.takeReset(dKey) : null;
    const common = {
      view: shown,
      mode: built && mode === 'app' ? 'app' : 'design',
      size,
      client: clients.some(c => c.id === client) ? client : clients[0].id,
      ...(custom ? { custom } : {}),
      app: built,
      host: hostFor(),
      popped: designs.windows(dKey) > 0,
      notice,
      ...(reset ? { reset } : {}),
      sizes,
      clients,
      version: designs.version(dKey),
    };
    if (hosted) {
      const state = stateOn();
      // Every titled route, with sample ids from this state; overlays under
      // their page. A page followed to inside the frame may not be one of
      // them (another record), and is listed by its route's title.
      const screens = pickable(routes, datasetFor(state)).map(({ id, title: name, ported }) => ({ id, title: name, ...(ported ? { ported: true } : {}) }));
      const path = designs.current(dKey) ?? screens[0]?.id ?? null;
      const review = reviewOf(dir, context);
      const matched = path && matchRoute(routes, path);
      if (matched && !screens.some(screen => screen.id === path)) screens.push({ id: path, title: matched.route.title ?? path });
      return {
        ...common,
        origin: designOrigin(req, folder, design),
        screens,
        current: screens.some(screen => screen.id === path) ? path : screens[0]?.id ?? null,
        states: states.map(({ id, title: name, file }) => ({ id, title: name, file })),
        state: state?.id ?? null,
        changed: designs.copy(dKey)?.stateId === (state?.id ?? null),
        events: readEvents(dir).map(event => ({ name: event.name, title: event.title })),
        approved: readSnapshots(dir)?.size ?? 0,
        review,
        stage: stageOf(review),
      };
    }
    // Plain screens/*.html (the design system's gallery): served as files.
    const screens = listScreens(dir);
    const wanted = designs.current(dKey);
    const current = screens.find(screen => screen.id === wanted) ?? screens[0] ?? null;
    return {
      ...common,
      origin: `${previewOrigin(req)}/f/${folder.id}/p/${design.id}/screens/`,
      screens: screens.map(screen => ({ id: screen.file, title: screen.title })),
      current: current?.file ?? null,
      states: [], state: null, changed: false, events: [], approved: 0,
      review: { failures: [], differ: [] },
      screensOnly: true,
      stage: null,
    };
  };

  /** What every part of the page knows: which design, where. */
  const basics = () => ({
    id: design.id,
    title: design.title,
    area: design.area || null,
    kind: design.kind,
    // In a design's worktree, the project is the repository it's a branch of.
    folder: { id: folder.id, name: folder.branch?.parentName ?? folder.name, ...(folder.branch ? { parentId: folder.branch.parentId } : {}) },
  });

  /** A session's draft, at the session's own address (R-d3v). */
  const draftOf = sessionId => {
    const saved = app.drafts.read(folder, design, sessionId);
    const at = `${base}/sessions/${draftKey(sessionId)}`;
    return { base: at, message: saved.message, attachments: saved.attachments.map(image => ({ id: image.id, name: image.name, url: `${at}/images/${image.id}/file` })) };
  };

  /** The design's branch, as the header and the About drawer show it. */
  const branchOf = () => {
    if (!entry) return null;
    const state = branchState(app, entry, design);
    return {
      id: state.id, branch: state.branch, into: state.into, check: state.check, failures: state.failures,
      behind: state.behind, worked: state.worked, remote: state.remote,
      building: state.building ? { title: state.building.title } : null,
      alsoChanges: state.alsoChanges ?? [],
      running: state.running ? { running: state.running.running, approved: state.running.approved, url: state.running.url, open: state.running.open, start: state.running.start } : null,
      merging: state.merging ? { from: state.merging.from, unresolved: state.merging.unresolved } : null,
      error: null,
    };
  };

  /**
   * Where the design stands, and the one next step (10.9): designing, changed
   * since approved, approved, building, built. Null for what isn't built
   * (the design system's gallery). { step, label, next }.
   */
  const stageOf = (review, branch = branchOf()) => {
    if (!hosted || design.kind === 'system') return null;
    const groups = backlogOf(dir).groups.filter(group => !isGallery(design, group));
    const approved = Boolean(readSnapshots(dir)?.size);
    if (branch?.building) return { step: 'building', label: `Building ${branch.building.title}`, next: 'checked against the approved design' };
    if (groups.length && groups.every(group => group.built)) {
      return { step: 'built', label: 'Built', next: !branch ? 'nothing left to build' : branch.remote ? 'push and open a pull request' : `merge into ${branch.into}` };
    }
    if (approved && review.differ.length) return { step: 'changed', label: 'The design changed since you approved it', next: 'approve again when it’s ready' };
    if (approved) return { step: 'approved', label: 'Approved', next: 'ready to build' };
    return { step: 'designing', label: 'Designing', next: 'approve it when it’s what you want built' };
  };

  /** The session's status line: its own turn, another session's, or nothing. */
  const turnOf = session => (session ? turns.state(folder, design, session.id) : turns.busy(folder, design) ? { kind: 'busy' } : { kind: 'idle' });

  const queuedOf = sessionId => (sessionId
    ? turns.queued(folder, design, sessionId).map(item => ({ id: item.id, message: item.text, images: item.images.length }))
    : []);

  /**
   * The design page's model (DesignPage, server/workspace.js), for a session
   * or a new one. `surface` is the window's way of looking (surfaceOf).
   */
  const pageModel = ({ session = null, surface = {}, showing = false, extra = {} } = {}) => {
    const all = listSessions(dir);
    const notes = notesOf(folder.path, dir, design.id);
    const system = systemFor();
    const shell = shellFor();
    const merged = app.branches.merged(parentId).find(note => note.design === design.id) ?? null;
    const surfaceModel = surfaceOf({ ...surface, showing });
    return {
      ...basics(),
      system: system && { id: system.id, title: system.title },
      shell: shell && { id: shell.id, title: shell.title },
      references: app.references.of(parentId).map(({ name, path }) => ({ name, path })),
      buildUrl: hosted && buildsPages(design) ? `${base}/build` : null,
      merged: merged && { branch: merged.branch, into: merged.into, when: whenWords(merged.at) },
      branch: branchOf(),
      sessions: all.map((item, i) => ({
        id: item.id,
        title: item.title,
        started: startedWords(item.startedAt),
        ...(item.build ? { build: true } : {}),
        // Where the latest session ended, for "Carry on from…" (R-e9t).
        ...(i === 0 ? { lastLine: lastLineOf(readEntries(dir, item.id)) } : {}),
      })),
      session: session && { id: session.id, title: session.title, ...(session.build ? { build: { title: session.build.title } } : {}) },
      state: turnOf(session),
      entries: session ? readEntries(dir, session.id).map(view.present) : [],
      rules: rulesOf(dir, context),
      questions: notes.questions,
      decisions: notes.decisions,
      dictation: app.dictation.state(),
      speechModels: SPEECH_MODELS,
      queued: queuedOf(session?.id),
      images: [],
      draft: draftOf(session?.id ?? null),
      surface: surfaceModel,
      stage: surfaceModel.stage,   // where the design stands, for the header (10.9)
      ...extra,
    };
  };

  /** The session the chat shows, for what lands in its message box from elsewhere. */
  const sessionOnShow = () => {
    const shown = designs.session(dKey);
    if (shown === 'new') return null;
    return (shown && readSession(dir, shown)) || null;
  };

  const fragment = req.headers['x-koda-fragment'] === '1';
  const sendView = (status, name, data, also = '') => send(res, status, render(`./${name}`, data) + also);
  const envelope = (into, html = '') => `\n<div ko-into="${into}">${html}</div>`;

  /**
   * The page, in its layout for a cold load: the chat beside the surface,
   * with any overlay already in its region, and the page's one live channel.
   */
  const designPage = (status, model, { session = null, regions = {}, path = url.pathname } = {}) => {
    const live = session ? `${base}/sessions/${session.id}/live?from=${model.entries.length}` : `${base}/live`;
    const body = render('./_session', { ...model, live });
    // In the app layout, like Prelude's other pages: the page brings its own
    // stylesheet and asks to fill the window, so Koda swaps it in from Home
    // as a fragment. From a page still in ds/v1 it comes whole (askedFromLayout).
    if (fragment && askedFromLayout(req, 'app') && !Object.keys(regions).length) return send(res, status, body);
    return send(res, status, render('./layout', { body, path, title, regions, system: true }));
  };

  /**
   * An overlay (a drawer or a modal over the page): alone for a fragment
   * request; a cold load gets the page beneath - the latest session - with
   * the overlay in its region.
   */
  const overlay = (name, data, region) => {
    const html = render(`./${name}`, data);
    if (fragment) return send(res, 200, html);
    const latest = listSessions(dir)[0] ?? null;
    designs.showSession(dKey, latest?.id ?? 'new');
    return designPage(200, pageModel({ session: latest, showing: true }), {
      session: latest,
      regions: { [region]: { html, location: url.pathname } },
      path: latest ? `${base}/sessions/${latest.id}` : base,
    });
  };

  /** The design surface, answering a form in the design bar. */
  const surfaceAnswer = (looking, notice = null) =>
    sendView(200, '_surface', { ...basics(), rules: rulesOf(dir, context), surface: surfaceOf({ ...looking, notice, showing: true }) });

  if (req.method === 'GET' && rest[0] === 'preview' && rest.length === 1) {
    const body = render('./_surface', { ...basics(), rules: rulesOf(dir, context), surface: surfaceOf({ ...fromQuery(), showing: true }) });
    if (fragment) return send(res, 200, body);
    return send(res, 200, render('./window-layout', { body: `<div class="stack design-page window-page">${body}</div>`, path: url.pathname, title, layout: { live: `${base}/live` } }));
  }

  // Show a page: in every window (R-c2m), and in the state named with it, as
  // Show does for a page the check or a rule names (R-pk8).
  if (req.method === 'POST' && rest[0] === 'screen' && rest.length === 1) {
    const form = await readForm(req);
    const wanted = String(form.get('surface.current') ?? form.get('screen') ?? '');
    const inState = form.get('surface.state') ?? form.get('state');
    if (hosted && inState && states.some(state => state.id === inState)) designs.showState(dKey, String(inState));
    const id = hosted ? wanted : wanted.replace(/\.html$/i, '');
    const known = hosted ? Boolean(matchRoute(routes, id)) : listScreens(dir).some(screen => screen.id === id);
    if (known) designs.show(dKey, id);
    return surfaceAnswer(fromForm(form));
  }

  // "Send event" (6e): the server speaks first. Its change goes to the working
  // copy of the state, as an accepted form's does, and its messages to every
  // window showing the design.
  if (req.method === 'POST' && rest[0] === 'events' && rest.length === 1 && hosted) {
    const form = await readForm(req);
    const name = String(form.get('event') ?? '');
    // The answer is a line for the bar's status region, never the surface: a
    // new frame would reload the page the event is meant to reach.
    const events = readEvents(dir);
    const sent = (notice, failed = false) => sendView(200, '_event-sent', { ...basics(), surface: { events: events.map(event => ({ name: event.name, title: event.title })) }, event: name, sent: { notice, failed } });
    const event = events.find(candidate => candidate.name === name);
    if (!event) return sent('That event is no longer in the design.', true);
    const state = stateOn();
    const working = structuredClone(datasetFor(state));
    const fired = await eventMessages(app, { folder, designDir: dir, event, dataset: working });
    if (fired.changed) designs.setCopy(dKey, state?.id ?? null, working);
    const heard = fired.messages.length ? app.channels.send(dKey, fired.messages) : 0;
    if (fired.failures.length) return sent(`${event.title}: ${fired.failures.map(failure => failure.view ? `${failure.view} doesn’t render` : failure.error).join('; ')}.`, true);
    return sent(heard ? `Sent: ${event.title}.` : `Sent: ${event.title}, but no page is listening. Its layout opens the channel from it.layout.live.`, !heard);
  }

  // "Reset data": throw away what forms changed, back to the state's file.
  if (req.method === 'POST' && rest[0] === 'reset' && rest.length === 1) {
    const form = await readForm(req);
    designs.resetCopy(dKey);
    return surfaceAnswer(fromForm(form));
  }

  if (req.method === 'POST' && rest[0] === 'state' && rest.length === 1) {
    const form = await readForm(req);
    const wanted = String(form.get('surface.state') ?? form.get('state') ?? '');
    if (states.some(state => state.id === wanted)) designs.showState(dKey, wanted);
    return surfaceAnswer(fromForm(form));
  }

  // A custom size (R-e5n, R-w3j): a width and a height from 200 to 4000
  // pixels, remembered for the design in place of the last one, and shown in
  // this window. Anything else shows the page fitting the panel.
  if (req.method === 'POST' && rest[0] === 'size' && rest.length === 1) {
    const form = await readForm(req);
    const width = pixels(form.get('surface.custom.width') ?? form.get('width'));
    const height = pixels(form.get('surface.custom.height') ?? form.get('height'));
    if (width && height) designs.setCustom(dKey, { width, height });
    return surfaceAnswer({ ...fromForm(form), size: width && height ? 'custom' : 'fit' });
  }

  // "Approve these screens": every page in every state, as it renders now,
  // becomes the design's snapshots, which the check then compares against.
  if (req.method === 'POST' && rest[0] === 'approve' && rest.length === 1 && hosted) {
    const form = await readForm(req);
    const review = await reviewDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design, designDir: dir });
    // Approving over pages that don't render would throw their approved versions away.
    const count = Math.max(1, states.length);
    const approved = review.failures.length ? 0 : writeSnapshots(dir, review.renders);
    // Approved pages may now be ready to build.
    if (approved) tell(app, { needs: true, projects: true });
    const notice = review.failures.length
      ? `Not approved: ${review.failures.length === 1 ? '1 page doesn’t' : `${review.failures.length} pages don’t`} render. Fix ${review.failures.length === 1 ? 'it' : 'them'} first.`
      : `Approved ${approved} ${approved === 1 ? 'page' : 'pages'} in ${count} ${count === 1 ? 'state' : 'states'}.`;
    // From the Build page (10.9): back to it, which says what happened. (Posted
    // on main, the design's branch was just made: its Build page is the worktree's.)
    if (/^\/f\/[0-9a-f]+\/d\/.+\/build$/.test(String(form.get('back') ?? ''))) {
      return review.failures.length ? buildPage(409, { notice }) : redirect(res, `${base}/build`);
    }
    return surfaceAnswer(fromForm(form), notice);
  }

  // Capture (R-k7c): the page as this window shows it - its page, state,
  // size and client, or the app - as a picture, into the message box of the
  // session the chat shows. Every chat reloads its tray on draft-changed.
  if (req.method === 'POST' && rest[0] === 'capture' && rest.length === 1) {
    const form = await readForm(req);
    const looking = fromForm(form);
    const answer = (data, also = '') => sendView(200, '_captured', data, also);
    const page = String(form.get('page') ?? '');
    const built = hosted ? appHere() : null;
    const inApp = Boolean(built) && looking.mode === 'app';
    const known = hosted ? Boolean(matchRoute(routes, page)) : listScreens(dir).some(screen => screen.file === page);
    if (!known) return answer({ error: 'That page is no longer in the design.' });
    const { sizes, clients } = sizesAndClients(folder.path);
    const size = looking.size === 'custom' ? designs.custom(dKey) : sizes.find(candidate => candidate.id === looking.size && candidate.width);
    const measured = value => { const n = Math.round(Number(value)); return n >= 50 && n <= 8000 ? n : null; };
    const width = size?.width ?? measured(form.get('frame.width')) ?? 1280;
    const height = size?.height ?? measured(form.get('frame.height')) ?? 800;
    const client = clients.find(candidate => candidate.id === looking.client) ?? clients[0];
    const at = inApp ? `${built.url}${page}` : hosted ? `${designOrigin(req, folder, design)}${page}` : `${previewOrigin(req)}/f/${folder.id}/p/${design.id}/screens/${encodeURIComponent(page)}`;
    let bytes;
    try {
      bytes = await capture({ url: at, width, height, whole: form.get('whole') === 'true', attributes: client.attributes ?? {} });
    } catch (error) {
      return answer({ error: `Couldn’t capture the page: ${error.message}` });
    }
    const session = sessionOnShow();
    const name = String(form.get('name') ?? '').trim() || 'Capture.png';
    const added = app.drafts.addImage(folder, design, session?.id ?? null, { name, bytes });
    if (added.error) return answer({ error: added.error });
    live.publish(designChannel(dKey), 'draft-changed');
    const draft = draftOf(session?.id ?? null);
    return answer(draft.attachments.at(-1), envelope('attachments?', render('./_attachments', draft)));
  }

  if (req.method === 'GET' && rest[0] === 'window' && rest.length === 1) {
    const body = render('./_window', { ...basics(), rules: rulesOf(dir, context), surface: surfaceOf({ ...fromQuery(), view: 'window', showing: true }) });
    if (fragment) return send(res, 200, body);
    return send(res, 200, render('./window-layout', { body, path: url.pathname, title: `${design.title} · design`, layout: { live: `${base}/live?view=window` } }));
  }

  /**
   * The page's one channel (server-sent events): the design's events
   * (design-changed, draft-changed), dictation's (dictation-changed), and,
   * on a session's page, the session's entries and status. While any page
   * listens, the design's files are watched.
   */
  const openChannel = (keys, initial = []) => {
    // A state's file changing drops what forms did to its data (R-a6x).
    const filesChanged = paths => {
      const copy = designs.copy(dKey);
      const changedState = copy && Array.isArray(paths) && listStates(dir).find(state => state.id === copy.stateId && paths.includes(`states/${state.file}`));
      if (changedState) designs.dropCopy(dKey, `${changedState.title}’s file changed, so what your forms did to its data was undone. The pages show the file as it is now.`);
      designs.filesChanged(dKey);
    };
    const release = watches.acquire(dKey, dir, filesChanged);
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
    return live.open([...keys, designChannel(dKey), DICTATION_KEY], req, res, initial, { onClose: () => { closed(); release(); releaseSystem(); releaseShell(); } });
  };

  if (req.method === 'GET' && rest[0] === 'live' && rest.length === 1) return openChannel([]);

  // --- the chat's overlays and parts ------------------------------------------

  if (req.method === 'GET' && rest.length === 1 && ['about', 'rules', 'questions'].includes(rest[0])) {
    return overlay(`_${rest[0]}`, pageModel(), 'drawer');
  }

  // What the person is looking at, for the message box's chip (R-r7h).
  if (req.method === 'GET' && rest[0] === 'looking-at' && rest.length === 1) {
    return sendView(200, '_looking-at', { ...basics(), surface: surfaceOf() });
  }

  // Answer a question, or start with a starting point: the message starts in
  // the box of the session the chat shows, after anything typed there, and
  // nothing is sent (R-y3h).
  if (req.method === 'POST' && ((rest[0] === 'start' && rest.length === 1) || (rest[0] === 'questions' && rest[2] === 'answer' && rest.length === 3))) {
    const form = await readForm(req);
    const start = String(form.get('message') ?? '');
    const sessionId = sessionOnShow()?.id ?? null;
    const typed = app.drafts.read(folder, design, sessionId).message.replace(/\s+$/, '');
    app.drafts.setMessage(folder, design, sessionId, typed ? `${typed}\n\n${start}` : start);
    return sendView(200, '_answering', draftOf(sessionId));
  }

  // An image the person attached, waiting or sent: full size, marked up, or
  // its file. Found by its id, from the design's address or a session's.
  const imagePath = rest[0] === 'sessions' && rest[2] === 'images' ? rest.slice(2) : rest[0] === 'images' ? rest : null;
  if (imagePath && imagePath.length >= 2 && imagePath.length <= 3) {
    const [, imageId, part] = imagePath;
    const image = app.drafts.find(folder, design, dir, imageId);
    if (!image) return notFound();
    const model = { id: image.id, base, name: image.name, url: `${base}/images/${image.id}/file`, sent: image.sent ? whenWords(image.sent) : null };
    if (req.method === 'GET' && part === 'file') {
      const type = IMAGE_SERVED[image.type];
      if (!type) return notFound();
      res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
      return createReadStream(image.path).pipe(res);
    }
    if (req.method === 'GET' && part === undefined) return overlay('_image', model, 'modal');
    if (req.method === 'GET' && part === 'markup') return overlay('_markup', model, 'modal');
    // The marked-up copy goes in the message box: in place of the original
    // if that was waiting there, else beside what's there. The original
    // never changes (R-u6p).
    if (req.method === 'POST' && part === 'markup') {
      const form = await readForm(req);
      const file = form.get('image');
      const sessionId = image.draft ? (image.draft === 'new' ? null : image.draft) : sessionOnShow()?.id ?? null;
      if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function') {
        const added = app.drafts.addImage(folder, design, sessionId, { name: file.name || `${image.name.replace(/\.[^.]+$/, '')} (marked up).png`, bytes: Buffer.from(await file.arrayBuffer()) }, { replacing: image.draft ? image.id : null });
        if (!added.error) live.publish(designChannel(dKey), 'draft-changed');
      }
      return sendView(200, '_attachments', draftOf(sessionId), envelope('modal?'));
    }
    return notFound();
  }

  // The session's draft (R-d3v): its images, what's typed, and adding or
  // removing an image (R-m2s: only images; anything else leaves it as it
  // was). At the session's address, or the design's for the session on show.
  const draftPath = rest[0] === 'sessions' && rest.length >= 3 && ['draft', 'attachments'].includes(rest[2])
    ? { sessionId: rest[1] === 'new' ? null : rest[1], parts: rest.slice(2) }
    : ['draft', 'attachments'].includes(rest[0]) ? { sessionId: sessionOnShow()?.id ?? null, parts: rest } : null;
  if (draftPath) {
    const { sessionId, parts } = draftPath;
    if (sessionId && !readSession(dir, sessionId)) return notFound();
    if (parts[0] === 'draft' && parts.length === 1) {
      if (req.method === 'GET') return sendView(200, '_attachments', draftOf(sessionId));
      if (req.method === 'POST') {
        const form = await readForm(req);
        app.drafts.setMessage(folder, design, sessionId, String(form.get('message') ?? ''));
        return sendView(200, '_draft-kept', draftOf(sessionId));
      }
    }
    if (parts[0] === 'attachments' && parts.length === 1 && req.method === 'POST') {
      const form = await readForm(req);
      for (const file of form.getAll('image')) {
        if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function' || !file.size) continue;
        app.drafts.addImage(folder, design, sessionId, { name: file.name || 'Image', bytes: Buffer.from(await file.arrayBuffer()) });
      }
      return sendView(200, '_attachments', draftOf(sessionId));
    }
    if (parts[0] === 'attachments' && parts[2] === 'remove' && parts.length === 3 && req.method === 'POST') {
      await readForm(req);
      app.drafts.remove(folder, design, sessionId, parts[1]);
      return sendView(200, '_attachments', draftOf(sessionId));
    }
    return notFound();
  }

  // Dictation (R-f2y, R-n5q, R-h4u): the person's set-up, on this machine.
  const dictationModel = () => ({ ...basics(), dictation: app.dictation.state(), speechModels: SPEECH_MODELS });
  if (rest[0] === 'dictation') {
    const action = rest.slice(1).join('/');
    if (req.method === 'GET' && action === '') return overlay('_dictation-ask', dictationModel(), 'modal');
    if (req.method === 'GET' && action === 'button') return sendView(200, '_dictation', dictationModel());
    if (req.method === 'POST' && action === '') {
      const form = await readForm(req);
      const switchTo = form.get('switchingTo');
      const chosen = switchTo ? app.dictation.switchTo(String(switchTo)) : app.dictation.choose(String(form.get('model') ?? ''));
      if (chosen.error) return sendView(422, '_dictation-ask', { ...dictationModel(), $errors: { model: chosen.error } });
      return sendView(200, '_dictation', dictationModel(), envelope('modal?'));
    }
    if (req.method === 'POST' && (action === 'remove' || action === 'cancel')) {
      await readForm(req);
      if (action === 'remove') app.dictation.remove(); else app.dictation.cancel();
      return sendView(200, '_dictation', dictationModel());
    }
    // What was said, added after what's typed - what was typed while it
    // listened included - in the session the chat shows (R-n5q). Transcribed
    // here; the recording goes nowhere else (R-f2y).
    if (req.method === 'POST' && action === 'transcribe') {
      const form = await readForm(req);
      const typed = String(form.get('message') ?? '');
      const audio = form.get('audio');
      const sessionId = sessionOnShow()?.id ?? null;
      let error = null;
      let said = '';
      try {
        if (!audio || typeof audio !== 'object' || typeof audio.arrayBuffer !== 'function') throw new Error('Nothing was recorded.');
        const words = [design.title, ...routes.filter(route => route.title).map(route => route.title), ...states.map(state => state.title)];
        said = await app.dictation.transcribe(Buffer.from(await audio.arrayBuffer()), { prompt: [...new Set(words)].join(', ') });
      } catch (failure) {
        error = failure.message;
      }
      const message = said ? `${typed.replace(/\s+$/, '')}${typed.trim() ? ' ' : ''}${said}` : typed;
      app.drafts.setMessage(folder, design, sessionId, message);
      const model = dictationModel();
      return sendView(200, '_dictation-ready', { ...model, dictation: { ...model.dictation, ...(error ? { error } : {}) }, draft: draftOf(sessionId) });
    }
    return notFound();
  }

  // A waiting message, taken back (it can't be edited: cancel and retype).
  if (req.method === 'POST' && rest[0] === 'queued' && rest[2] === 'cancel' && rest.length === 3) {
    await readForm(req);
    const gone = turns.cancel(folder, design, rest[1]);
    for (const image of gone?.images ?? []) rmSync(join(folder.path, ...image.file.split('/')), { force: true });
    const sessionId = gone?.sessionId ?? sessionOnShow()?.id ?? null;
    if (gone) live.publish(sessionKey(folder, design, gone.sessionId), statusMessage(turns.state(folder, design, gone.sessionId)));
    return sendView(200, '_queued', { ...basics(), queued: queuedOf(sessionId) });
  }

  // What the agent is told besides the design: what else it may read, the
  // folder's design system and shell, and which format the design is in. A
  // design made of views may also read Koda's own guidance. A build session
  // (step 7) brings its own instructions and permissions; on a design's
  // branch (step 9) every turn is committed, and a design may change the
  // design system and the shell when it needs to.
  const agentContext = (session = null) => {
    const views = format() === 'views';
    const references = app.references.of(parentId);
    const system = systemFor();
    const shell = shellFor();
    const shared = entry && design.kind === 'design' ? [system?.path, shell?.path].filter(Boolean) : [];
    return {
      references: views ? [...references, { name: 'Koda', path: kodaPackage }] : references,
      system,
      shell,
      shared,
      format: format(),
      kodaPath: views ? kodaPackage : null,
      stack: (() => { const config = readHostConfig(folder.path); return config && { ext: config.views, guide: config.guide }; })(),
      // After each turn, render every route of a design of views, and say what fails.
      // Pages that differ from their approved snapshots are shown, not told.
      check: views
        ? async () => {
          if (!isHosted(dir)) return null;
          // A build turn may have changed the app's code, not just its views:
          // start its host afresh, so the check builds and renders what's there now.
          if (session?.build) app.hosts.stop(folder);
          // A host waiting for the person's approval is nobody's failure.
          const host = readHostConfig(folder.path);
          if (host && !app.hosts.approved(folder, host)) {
            return { blocked: 'Prelude didn’t check the pages: this repository’s design host needs your approval first. Approve it in the design bar, then send the next message.' };
          }
          const review = await reviewDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design, designDir: dir });
          const result = { failures: review.failures, rendered: [...review.renders.values()].filter(Boolean).length, differ: review.differ, warnings: review.warnings, ahead: review.ahead };
          // A feature that changed the shell on its branch: its gallery is checked too.
          if (entry && shell) {
            let changed = [];
            try { changed = app.branches.status(entry).alsoChanges; } catch { /* git couldn't say */ }
            const shellDir = join(folder.path, ...shell.path.split('/'));
            if (changed.some(path => path.startsWith(`${shell.path}/`)) && isHosted(shellDir)) {
              const shellDesign = findDesign(folder.path, shell.id.split('/'))?.design;
              const gallery = shellDesign && await reviewDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design: shellDesign, designDir: shellDir });
              if (gallery) result.failures.push(...gallery.failures.map(f => ({ ...f, path: `${shell.title}: ${f.path}` })));
            }
          }
          return result;
        }
        : null,
      // What an update from main brought in, told once; or, while one clashed
      // and isn't resolved yet, the files to resolve, told with every message.
      preface: entry ? (() => {
        const merging = (() => { try { return app.branches.merging(entry); } catch { return null; } })();
        if (merging?.unresolved.length) {
          return `(From Prelude, not the person: ${merging.from} is half brought into this branch, and these files clash: ${merging.unresolved.join(', ')}. Each holds both versions between git's conflict markers (<<<<<<< this branch, ======= then ${merging.from}, >>>>>>>). Resolve every one before anything else: keep what ${merging.from} has, put this branch's change on top of it, drop anything ${merging.from} already does, and remove every marker. Prelude commits the merge after your turn once no marker is left.)`;
        }
        const files = app.branches.takeCameIn(entry);
        return files ? `(From Prelude, not the person: the main branch was brought into this branch, and these files came in: ${files.slice(0, 30).join(', ')}${files.length > 30 ? ', …' : ''}. Take them into account.)` : null;
      })() : null,
      afterTurn: entry ? ({ message, check }) => afterBranchTurn(session, message, check) : null,
      ...buildContext(session, references),
    };
  };

  // After a turn on a design's branch: tidy what building made redundant,
  // commit the turn, and finish the build once its group is built. A build
  // turn also says where the app is running and what's next (10.7).
  const afterBranchTurn = (session, message, check = null) => {
    const build = session?.build;
    const ported = text => {
      try { return Object.values(JSON.parse(text)).filter(route => typeof route?.view === 'string' && route.view.startsWith('@app/')).length; } catch { return 0; }
    };
    const portedBefore = build ? ported(textAt(entry.path, 'HEAD', `${PRELUDE_DIR}/${design.id}/routes.json`)) : 0;
    if (build) {
      const isApp = build.group === APP_GROUP.key;
      const designViews = join(dir, 'views');
      const stillDesigned = [...readRoutes(dir).map(route => route.view), ...readPostRoutes(dir).flatMap(post => [post.form, post.answer.view, ...post.answer.also.map(also => also.view)])]
        .some(view => view && !view.startsWith('@app/'));
      if (!isApp && !stillDesigned && existsSync(designViews)) rmSync(designViews, { recursive: true, force: true });
      // A redesign ported back (step 10): the app's file is the view again, so where it came from no longer matters.
      try {
        const file = join(dir, 'routes.json');
        const table = JSON.parse(readFileSync(file, 'utf8'));
        let cleared = false;
        for (const route of Object.values(table)) {
          if (route && typeof route.view === 'string' && route.view.startsWith('@app/') && route.from) { delete route.from; cleared = true; }
        }
        if (cleared) writeFileSync(file, JSON.stringify(table, null, 2) + '\n');
      } catch { /* no routes to tidy */ }
    }
    if (design.kind === 'shell') {
      const ext = readHostConfig(folder.path)?.views ?? '.eta';
      // An agent can't delete files, so an emptied layouts.json is a removed one.
      const linksFile = join(dir, 'layouts.json');
      try { if (existsSync(linksFile) && Object.keys(JSON.parse(readFileSync(linksFile, 'utf8'))).length === 0) rmSync(linksFile); } catch { /* not empty, or not JSON: the agent's */ }
      // A shell layout that now names the app's file (layouts.json) has no copy of its own.
      const links = shellLayoutLinks(dir);
      for (const name of Object.keys(links)) rmSync(join(dir, 'layouts', `${name}${ext}`), { force: true });
      // One whose link is gone gets its copy back, as it was before Prelude
      // removed it: only one removed for a link, never one deleted on purpose.
      for (const path of removedUnder(entry.path, `${PRELUDE_DIR}/${design.id}/layouts`)) {
        const name = path.split('/').pop();
        const layout = name.endsWith(ext) ? name.slice(0, -ext.length) : null;
        if (!layout || links[layout]) continue;
        const file = join(entry.path, ...path.split('/'));
        const before = !existsSync(file) && beforeRemoval(entry.path, path);
        if (!before) continue;
        let linkedThen = null;
        try { linkedThen = JSON.parse(textAt(entry.path, before.removedIn, `${PRELUDE_DIR}/${design.id}/layouts.json`) ?? '{}')[layout]; } catch { /* no links then */ }
        if (typeof linkedThen === 'string' && linkedThen.startsWith('@app/')) {
          mkdirSync(dirname(file), { recursive: true });   // git drops a folder its last file left
          writeFileSync(file, before.text);
        }
      }
    }
    const routesFile = join(dir, 'routes.json');
    const portedNow = build && existsSync(routesFile) ? ported(readFileSync(routesFile, 'utf8')) : 0;
    const wasMerging = app.branches.merging(entry);
    const commit = app.branches.commit(entry, `${build ? build.title : design.title}: ${message.split('\n')[0].slice(0, 60)}`);
    // An update that clashed: committed once the agent has resolved every file, else said what's left.
    const stillMerging = wasMerging && app.branches.merging(entry);
    if (stillMerging?.unresolved.length) {
      return { type: 'note', failed: true, text: `${stillMerging.from} is still half brought in: ${stillMerging.unresolved.join(', ')} still ${stillMerging.unresolved.length === 1 ? 'has' : 'have'} conflict markers, so nothing was committed. Ask the agent to resolve ${stillMerging.unresolved.length === 1 ? 'it' : 'them'}, or abandon the update.` };
    }
    const finishedMerge = wasMerging && commit ? ` That finishes bringing ${wasMerging.from} in: every clash is resolved.` : '';
    let done = false;
    if (build) {
      done = Boolean(build.group === APP_GROUP.key ? appOf(folder.path).built
        : build.group === LAYOUTS_GROUP.key ? shellLayoutsOf(folder.path)?.unbuilt.length === 0
        : build.group === ACROSS.key ? !backlogOf(dir).designWide.some(rule => rule.proposed)
        : backlogOf(dir).groups.find(g => g.key === build.group)?.built);
      if (done) {
        app.branches.building(entry, null);
        // Built as of this commit: a later design change makes it due again (step 10).
        app.branches.markBuilt(entry, build.group);
      }
    }
    const committed = commit && { type: 'note', text: `Committed to ${entry.branch} (${commit}).${finishedMerge}` };
    if (!build) return committed;
    // What's next, from the turn's check: shown to the person, never told to the agent.
    let into = 'main';
    try { into = app.branches.status(entry).into; } catch { /* git couldn't say */ }
    const running = appRunning(app, entry);
    const next = {
      type: 'next',
      group: build.title,
      built: done,
      checked: Boolean(check),
      failures: check?.failures?.length ?? 0,
      differ: check?.differ?.length ?? 0,
      app: running && { url: running.url, running: running.running, open: running.open },
      // The first build turn that makes a route the app's own says what the design window shows now.
      firstPorted: portedBefore === 0 && portedNow > 0,
      finish: { url: `/f/${parentId}`, label: remoteOf(entry.path) ? 'Push and open a pull request' : `Merge into ${into}` },
    };
    return [committed, next];
  };

  // A build session: writes the app, with its own instructions.
  const buildContext = (session, references) => {
    const build = session?.build;
    if (!build || !entry) return {};
    const backlog = groupsOf(app, { entry, design, dir });
    const isApp = build.group === APP_GROUP.key;
    const group = isApp ? APP_GROUP : backlog.groups.find(g => g.key === build.group) ?? { title: build.title, routes: [], posts: [], rules: [] };
    const config = readHostConfig(folder.path);
    const stack = config && { ext: config.views, guide: config.guide };
    // The app's layouts the group's pages render in, so the brief can name them (8c).
    const layouts = shellLayoutsOf(folder.path);
    const pageLayouts = layouts ? layoutsOfGroup(group).map(name => ({ name, file: layouts.links[name]?.slice(5) ?? null })) : [];
    // The page's stories, edits and all, which the build is checked against (R-n4j).
    const designPath = `${PRELUDE_DIR}/${design.id}`;
    const stories = group.slug && group.fingerprint
      ? storiesBrief(dir, group.slug, readStory(dir, group.slug, { url: '', fingerprint: group.fingerprint, changes: group.changes }), designPath)
      : null;
    return {
      mode: 'build',
      systemPrompt: build.group === LAYOUTS_GROUP.key
        ? layoutsBuildPrompt({ shell: design, layouts: layouts?.unbuilt ?? [], app: appOf(folder.path), branch: entry.branch, references, stack, kodaPath: kodaPackage })
        : isApp && appOf(folder.path).existing
        ? connectAppPrompt({ shell: design, designs: listDesigns(folder.path), system: systemFor(), branch: entry.branch, references, kodaPath: kodaPackage })
        : isApp
        ? appBuildPrompt({ folderPath: folder.path, stack: appOf(folder.path).stack ?? DEFAULT_STACK, shell: design, designs: listDesigns(folder.path), system: systemFor(), branch: entry.branch, references, kodaPath: kodaPackage, kodaVersion })
        // Across the design is the design-wide rules and events themselves.
        : buildPrompt({ title: design.title, designPath, group, change: group.incremental ? group.change : null, designWide: group.key === ACROSS.key ? [] : backlog.designWide, designEvents: group.key === ACROSS.key ? [] : backlog.events ?? [], layouts: pageLayouts, stories, branch: entry.branch, references, stack, kodaPath: kodaPackage }),
    };
  };

  /**
   * The Build page's model (BuildPage, build.js): the pages still to build,
   * each with what it changes in the app and its story, if one was asked
   * for; what's built and unchanged folds away (step 10). Declared, not
   * assigned, like buildPage and writeStories: Approve answers with them too,
   * from further up.
   */
  function buildView() {
    const groups = hosted && buildsPages(design) ? groupsOf(app, { entry, design, dir }).groups : [];
    const appHere = appOf(folder.path);
    let appOnMain = appHere;
    try { if (entry) appOnMain = appOf(app.folders.get(parentId).path); } catch { /* the folder's gone */ }
    // Each group's newest build session, to get back to it.
    const built = buildSessions(dir);
    const sessionOf = key => {
      const session = built.get(key);
      return session ? { title: session.title, url: `${base}/sessions/${session.id}` } : null;
    };
    const project = { id: parentId, name: folder.branch?.parentName ?? folder.name };
    const toBuild = groups.filter(group => group.toBuild);
    // Pages build one at a time, on the design's branch.
    const building = entry?.building ? toBuild.find(group => group.key === entry.building.group) ?? null : null;
    return {
      id: design.id,
      title: design.title,
      folder: project,
      base,
      branch: entry?.branch ?? null,
      // There's an app once main (or this folder) has one; it's built into once this branch has it.
      app: { built: appHere.built || appOnMain.built, onBranch: appHere.built, stack: appHere.stack ?? appOnMain.stack ?? '', url: `/f/${parentId}#app` },
      // Builds wait for approved screens (10.9); the Build page offers Approve.
      approved: Boolean(readSnapshots(dir)?.size),
      building: building && { group: building.slug, title: building.title, session: sessionOf(building.key) ?? { title: building.title, url: base } },
      writing: app.stories.writingAll(dir),
      updateUrl: entry ? `/f/${parentId}/branches/${entry.id}/update` : null,
      groups: toBuild.map(group => groupView(group, { project, session: sessionOf(group.key) })),
      unchanged: groups.filter(group => !group.toBuild && group.key !== ACROSS.key).map(group => ({ title: group.title })),
    };
  }

  /**
   * A page still to build, as the Build page and its story's page show it
   * (BuildGroup, build.js): what it changes, and its stories, if asked for.
   */
  function groupView(group, { project = { id: parentId, name: folder.branch?.parentName ?? folder.name }, session = null } = {}) {
    const url = `${base}/build/stories/${group.slug}`;
    return {
      id: group.slug,
      key: group.key,
      title: group.title,
      kind: group.kind,
      url,
      folder: { name: project.name, url: `/f/${project.id}` },
      design: { title: design.title, url: base },
      writing: app.stories.writing(dir, group.slug),
      instruction: app.stories.instruction(dir, group.slug),
      changes: group.changes,
      session,
      story: readStory(dir, group.slug, { url, fingerprint: group.fingerprint, changes: group.changes }),
    };
  }

  /**
   * A page's story (prelude/build), or a part of it, in the app layout like
   * the Build page, with the app's live channel: a story arriving reloads its
   * stories (story-written). A cold load of the rewrite modal has the page
   * beneath, the modal in its region.
   */
  function storyPage(status, group, { view = 'build/story', model = null, modal = null } = {}) {
    const page = groupView(group);
    const html = render(`./${view}`, model ?? page);
    if (fragment && askedFromLayout(req, 'app')) return send(res, status, html);
    const regions = modal ? { modal: { html, location: url.pathname } } : {};
    const body = modal || view === 'build/story' ? render('./build/story', page) : html;
    return send(res, status, render('./layout', { body, path: modal ? page.url : url.pathname, title: `${group.title} · Build · ${title}`, layout: { live: APP_LIVE, needsYou: waitingOf(app) }, regions, system: true }));
  }

  /**
   * The Build page, or a part of it, in the app layout like Prelude's other
   * pages, with the app's live channel: a story arriving reloads the pages
   * (story-written). A refusal the page has no place for is said in the
   * layout's notice region.
   */
  function buildPage(status, { view = '_build', notice = null } = {}) {
    const model = buildView();
    const body = render(`./${view}`, model);
    if (fragment && askedFromLayout(req, 'app') && !notice) return send(res, status, body);
    const regions = notice ? { notice: { html: render('./build/_refused', { message: notice }).trim(), location: `${base}/build` } } : {};
    return send(res, status, render('./layout', { body, path: view === '_build' ? `${base}/build` : `${base}/build/pages`, title: `Build · ${title}`, layout: { live: APP_LIVE, needsYou: waitingOf(app) }, regions, system: true }));
  }

  /**
   * Have the agent write pages' stories, one at a time, each kept with the
   * design on its branch (R-u6t): committed once it's written, unless a turn
   * is under way, whose own commit takes it. Each one written says so down
   * the app's channel (story-written), and the Build page's pages reload.
   */
  function writeStories(chosen, { all = false, instruction = '' } = {}) {
    const designPath = `${PRELUDE_DIR}/${design.id}`;
    const { groups } = groupsOf(app, { entry, design, dir });
    const references = app.references.of(parentId);
    const approved = Boolean(readSnapshots(dir)?.size);
    app.stories.write({
      dir, cwd: folder.path, designPath, all,
      references: references.map(reference => reference.path),
      jobs: chosen.map(group => ({
        id: group.slug,
        title: group.title,
        fingerprint: group.fingerprint,
        changes: group.changes,
        instruction,
        systemPrompt: storyPrompt({
          title: design.title, designPath, group, storiesPath: `${designPath}/stories/${group.slug}`, states, approved, references,
          rewrite: hasStory(dir, group.slug),
          others: groups.filter(other => other.key !== group.key && other.key !== ACROSS.key && other.toBuild).map(other => other.title),
        }),
      })),
      onWritten: () => {
        if (entry && turns.state(folder, design, null).kind === 'idle') {
          try { app.branches.commit(entry, `${design.title}: a story, written by the agent (committed by Prelude)`); } catch (error) { console.error(error); }
        }
        app.live.publish(APP_CHANNEL, 'story-written');
      },
    });
  }
  /**
   * Start a turn in a session with the person's messages: one, or those that
   * waited, together in the order written (R-z4k). Each item: { text,
   * images, lookingAt, prompt } (prompt: what the agent is told).
   */
  const startTurn = (session, items) => turns.start({
    folder, design, designDir: dir, sessionId: session.id,
    message: items.map(item => item.prompt).join('\n\n'),
    shown: items.map(({ text, images, lookingAt }) => ({ text, images, lookingAt })),
    stopUrl: `${base}/sessions/${session.id}/stop`,
    view,
    onIdle: sendWaiting,
    ...agentContext(session),
  });

  /** When a turn ends, the messages that waited go, the longest-waiting session's first. */
  function sendWaiting() {
    const waiting = turns.takeQueued(folder, design);
    if (!waiting.length) return;
    const session = readSession(dir, waiting[0].sessionId);
    if (!session) return sendWaiting();
    live.publish(sessionKey(folder, design, session.id), envelope('queued').trim());
    const started = startTurn(session, waiting);
    if (started.error) appendEntry(dir, session.id, { type: 'note', failed: true, text: `The messages that waited couldn’t be sent: ${started.error}` });
  }

  // The Build page (prelude/build):
  //   GET  …/build           the page
  //   GET  …/build/pages     the pages still to build, reloaded as stories arrive
  //   POST …/build/stories   Write every story: the agent writes each page's that has none
  if (req.method === 'GET' && rest[0] === 'build' && rest.length === 1 && hosted && buildsPages(design)) {
    return buildPage(200);
  }
  if (req.method === 'GET' && rest[0] === 'build' && rest[1] === 'pages' && rest.length === 2 && hosted && buildsPages(design)) {
    return buildPage(200, { view: 'build/_pages' });
  }
  if (req.method === 'POST' && rest[0] === 'build' && rest[1] === 'stories' && rest.length === 2 && hosted && buildsPages(design)) {
    const form = await readForm(req);
    if (form.get('writing') === 'true') {
      const unwritten = groupsOf(app, { entry, design, dir }).groups.filter(group => group.toBuild && !hasStory(dir, group.slug));
      writeStories(unwritten, { all: true });
    }
    return redirect(res, `${base}/build`);
  }

  // A page's story (prelude/build):
  //   GET  …/build/stories/:group                  the page
  //   GET  …/build/stories/:group/list             its stories, reloaded as one arrives
  //   GET  …/build/stories/:group/rewrite          Rewrite the story, in the modal
  //   POST …/build/stories/:group                  write it, or write it again (with an instruction)
  //   GET  …/build/stories/:group/story/:n         one story
  //   GET  …/build/stories/:group/story/:n/edit    its editor, in its place
  //   POST …/build/stories/:group/story/:n         save an edit; refused empty
  if (rest[0] === 'build' && rest[1] === 'stories' && rest.length >= 3 && hosted && buildsPages(design)) {
    const [, , slug, part, number, more, ...beyond] = rest;
    const group = groupsOf(app, { entry, design, dir }).groups.find(one => one.toBuild && one.slug === slug);
    if (!group || beyond.length) return notFound();
    const pageUrl = `${base}/build/stories/${group.slug}`;
    if (part === undefined && req.method === 'GET') return storyPage(200, group);
    if (part === 'list' && number === undefined && req.method === 'GET') return storyPage(200, group, { view: 'build/_stories' });
    if (part === 'rewrite' && number === undefined && req.method === 'GET') return storyPage(200, group, { view: 'build/_rewrite', modal: true });
    if (part === undefined && req.method === 'POST') {
      const form = await readForm(req);
      // Rewriting replaces the edits made by hand; the modal says so before it's sent (R-z2m).
      if (form.get('writing') === 'true') writeStories([group], { instruction: String(form.get('instruction') ?? '').trim() });
      return redirect(res, pageUrl);
    }
    if (part !== 'story' || !number) return notFound();
    const storyOf = () => readStory(dir, group.slug, { url: pageUrl, fingerprint: group.fingerprint, changes: group.changes })?.stories.find(one => one.id === number) ?? null;
    const story = storyOf();
    if (!story) return notFound();
    if (more === undefined && req.method === 'GET') return storyPage(200, group, { view: 'build/_story', model: story });
    if (more === 'edit' && req.method === 'GET') return storyPage(200, group, { view: 'build/_story-edit', model: story });
    if (more === undefined && req.method === 'POST') {
      const markdown = String((await readForm(req)).get('markdown') ?? '');
      if (!markdown.trim()) return storyPage(422, group, { view: 'build/_story-edit', model: { ...story, markdown, $errors: { markdown: 'This is required.' } } });
      saveStory(dir, group.slug, number, markdown, { by: gitUser(folder.path) });
      // A person's edit is kept with the design on its branch, like the agent's (R-u6t).
      if (entry && turns.state(folder, design, null).kind === 'idle') {
        try { app.branches.commit(entry, `${design.title}: a story, edited by hand (committed by Prelude)`); } catch (error) { console.error(error); }
      }
      return storyPage(200, group, { view: 'build/_story', model: storyOf() });
    }
    return notFound();
  }

  // Build a group on the design's branch: a build session, briefed from the
  // group, its first turn started. The app build (group @app) is the shell's.
  if (req.method === 'POST' && rest[0] === 'builds' && rest.length === 1 && entry) {
    const key = String((await readForm(req)).get('group') ?? '');
    const isApp = key === APP_GROUP.key && design.kind === 'shell';
    const work = buildsPages(design) && hosted ? groupsOf(app, { entry, design, dir }).groups : [];
    const group = isApp ? APP_GROUP : work.find(g => g.key === key) ?? null;
    const refuse = notice => buildPage(409, { notice });
    if (!group) return buildPage(422, { notice: 'That page is no longer in the design.' });
    // Features are built into the app, so the app comes first (step 8), and
    // must be on this branch too.
    if (!isApp && !appOf(folder.path).built) {
      return refuse(buildView().app.built
        ? 'The app is on main, but not on this design’s branch yet. Bring main into the branch first (Update from main).'
        : 'The app isn’t built yet. Build it first, from the project page.');
    }
    // A page renders in its layout, so the shell's layouts it uses come first (8c).
    if (group.needsLayouts?.length) {
      return refuse(`These pages render in the shell’s ${group.needsLayouts.map(name => `“${name}”`).join(' and ')} ${group.needsLayouts.length === 1 ? 'layout' : 'layouts'}, which the app hasn’t got yet. Build the shell’s layouts first, from the shell’s Build page.`);
    }
    // A build is checked against the approved screens, so they come first (10.9).
    // The app build and the shell's layouts aren't checked against screens.
    if (![APP_GROUP.key, LAYOUTS_GROUP.key].includes(group.key) && !readSnapshots(dir)?.size) {
      return refuse('Approve the design first: a build is checked against its approved screens, so there has to be something to check against.');
    }
    if (!isApp && entry.building && entry.building.group !== key && work.some(g => g.key === entry.building.group && g.toBuild)) {
      return refuse(`This design is building ${entry.building.title} now. Groups are built one at a time.`);
    }
    if (turns.state(folder, design, null).kind !== 'idle') return refuse('The agent is working on this design. Wait for it to finish.');
    app.branches.building(entry, group);
    const connecting = isApp && appOf(folder.path).existing;
    const message = connecting ? 'Connect the app.' : isApp ? 'Build the app.' : group.key === LAYOUTS_GROUP.key ? 'Build the shell’s layouts.' : `Build ${group.title}.`;
    const session = createSession(dir, { title: connecting ? 'Connect the app' : isApp ? 'Build the app' : `Build: ${group.title}`, build: { group: group.key, title: group.title } });
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${base}/sessions/${session.id}/stop`, view, onIdle: sendWaiting, ...agentContext(session) });
    if (started.error) return refuse(started.error);
    return redirect(res, `${base}/sessions/${session.id}`);
  }

  const [section, sessionId, action, ...extra] = rest;
  if (extra.length > 0) return notFound();

  // The page: a session, or - with none yet, or asked for - a new one.
  const sessionPage = (status, session, extraModel = {}) => {
    designs.showSession(dKey, session?.id ?? 'new');
    return designPage(status, pageModel({ session, showing: true, extra: extraModel }), { session });
  };

  if (section === undefined && req.method === 'GET') {
    const latest = listSessions(dir)[0];
    return latest ? redirect(res, `${base}/sessions/${latest.id}`) : sessionPage(200, null);
  }

  if (section !== 'sessions') return notFound();

  if (sessionId === 'new' && action === undefined && req.method === 'GET') return sessionPage(200, null);

  /**
   * A message as the person sent it, from the composer's fields and the
   * session's draft: its words, the images in the tray (only those in the
   * draft), and what they were looking at, unless they turned that off
   * (R-r7h). { text, ids, lookingAt: { words, said } | null, include }.
   */
  const messageOf = (form, sessionId) => {
    const text = String(form.get('message') ?? '').trim();
    const draft = app.drafts.read(folder, design, sessionId);
    const ids = form.getAll('attachments').map(String).filter(id => draft.attachments.some(image => image.id === id));
    const include = form.getAll('lookingAt.include').map(String).at(-1) ?? null;
    const page = String(form.get('lookingAt.page') ?? '');
    let lookingAt = null;
    if (include === 'true' && page) {
      const state = states.find(candidate => candidate.id === String(form.get('lookingAt.state') ?? '')) ?? null;
      const screen = hosted
        ? pickable(routes, datasetFor(state ?? stateOn())).find(pick => pick.id === page) ?? { title: matchRoute(routes, page)?.route.title ?? page }
        : listScreens(dir).find(candidate => candidate.file === page) ?? { title: page };
      const size = String(form.get('lookingAt.size') ?? '').trim();
      lookingAt = {
        // As the transcript shows it, under the bubble.
        words: [screen.title, state?.title, size].filter(Boolean).join(' · '),
        // As the agent is told it: the page, the state, and the size and client
        // when they aren't the defaults.
        said: `(The person was looking at ${screen.title} (${page})${state ? `, in the "${state.title}" state` : ''}${size ? `, shown as ${size.split(' · ').join(', ')}` : ''} when they wrote this.)`,
      };
    }
    return { text, ids, lookingAt, include };
  };

  /** What the agent is told: the words, where the images are, and what the person was looking at. */
  const promptOf = (text, images, lookingAt) => [
    text,
    images.length ? `(The person attached ${images.length === 1 ? 'an image' : `${images.length} images`} to this message. Read ${images.length === 1 ? 'it' : 'them'}: ${images.map(image => image.file).join(', ')}.)` : null,
    lookingAt?.said ?? null,
  ].filter(Boolean).join('\n\n');

  // The first message starts a session. Words, images, or both (R-b6d).
  if (sessionId === undefined && req.method === 'POST') {
    const form = await readForm(req);
    const said = messageOf(form, null);
    const refuse = (status, error) => sessionPageComposer(status, null, { message: said.text, lookingAt: { include: said.include }, $errors: { message: error } });
    if (!said.text && !said.ids.length) return refuse(422, 'Write a message, or attach an image.');
    if (turns.busy(folder, design)) return refuse(409, 'The agent is working on this design in another session. Wait for it to finish.');
    const session = createSession(dir, { title: said.text ? titleFrom(said.text) : 'Images' });
    const images = app.drafts.send(folder, design, dir, null, session.id, said.ids);
    const started = startTurn(session, [{ text: said.text, images, lookingAt: said.lookingAt?.words ?? null, prompt: promptOf(said.text, images, said.lookingAt) }]);
    if (started.error) return refuse(409, started.error);
    return redirect(res, `${base}/sessions/${session.id}`);
  }

  /** The message box, answering a form: refused, or afresh. */
  function sessionPageComposer(status, session, extraModel = {}, also = '') {
    return sendView(status, '_composer', pageModel({ session, extra: extraModel }), also);
  }

  const session = sessionId && readSession(dir, sessionId);
  if (!session) return notFound();

  if (action === undefined && req.method === 'GET') {
    // Opened: a turn it finished no longer needs the person (R-8hc).
    app.seen.mark(sessionKey(folder, design, session.id));
    tell(app, { needs: true });
    return sessionPage(200, session);
  }

  // A message: sent now, or - while the agent works - waiting to go when its
  // turn ends, with the others written meanwhile (R-z4k). At …/messages or
  // …/queue alike; the answer says which happened.
  if ((action === 'messages' || action === 'queue') && req.method === 'POST') {
    const form = await readForm(req);
    const said = messageOf(form, session.id);
    if (!said.text && !said.ids.length) {
      return sessionPageComposer(422, session, { message: '', lookingAt: { include: said.include }, $errors: { message: 'Write a message, or attach an image.' } });
    }
    // Sending empties the draft: its images move into the session's folder.
    const images = app.drafts.send(folder, design, dir, session.id, session.id, said.ids);
    const item = { sessionId: session.id, text: said.text, images, lookingAt: said.lookingAt?.words ?? null, prompt: promptOf(said.text, images, said.lookingAt) };
    if (turns.busy(folder, design)) {
      turns.enqueue(folder, design, item);
      live.publish(sessionKey(folder, design, session.id), statusMessage(turns.state(folder, design, session.id)));
      const model = pageModel({ session });
      return sendView(200, '_composer', model, envelope('queued', render('./_queued', model)));
    }
    const started = startTurn(session, [item]);
    if (started.error) {
      app.drafts.restore(folder, design, session.id, { message: said.text, images: images.map(image => ({ id: image.id, name: image.name, path: join(folder.path, ...image.file.split('/')) })) });
      return sessionPageComposer(409, session, { $errors: { message: started.error } });
    }
    // The transcript afresh: the message is in it, and the starting points
    // have gone (R-e9t).
    const model = pageModel({ session });
    return sendView(200, '_composer', model, envelope('transcript', render('./_transcript', model)));
  }

  // Stop: nothing that waited is sent; it goes back in the box, to send or
  // change (R-9cn).
  if (action === 'stop' && req.method === 'POST') {
    await readForm(req);
    const waiting = turns.takeQueued(folder, design, session.id);
    turns.stop(folder, design, session.id);
    if (waiting.length) {
      const draft = app.drafts.restore(folder, design, session.id, {
        message: waiting.map(item => item.text).filter(Boolean).join('\n\n'),
        images: waiting.flatMap(item => item.images.map(image => ({ id: image.id, name: image.name, path: join(folder.path, ...image.file.split('/')) }))),
      });
      live.publish(sessionKey(folder, design, session.id), [
        envelope('queued').trim(),
        envelope('message-box', render('./_message-box', { message: draft.message })).trim(),
      ].join('\n'));
      live.publish(designChannel(dKey), 'draft-changed');
    }
    return sendView(200, '_status', { kind: 'stopping' });
  }

  if (action === 'live' && req.method === 'GET') {
    const from = Math.max(0, Number.parseInt(url.searchParams.get('from') ?? '0', 10) || 0);
    // Catch up and subscribe in the same tick, so nothing published in between is missed.
    return openChannel([sessionKey(folder, design, session.id)], turns.catchUp(folder, design, dir, session.id, from, view));
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
  // A post with no form at all (no body, no type) is an empty form, not an error.
  if (!body.length && !/form/i.test(type)) return new FormData();
  // Koda posts FormData (multipart); a browser without script posts urlencoded.
  // Let the platform parse either - never decode multipart as text by hand.
  const request = new Request('http://localhost/', { method: 'POST', headers: { 'content-type': type }, body });
  return request.formData();
}
