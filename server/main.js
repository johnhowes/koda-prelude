// Prelude's server: plain node:http, a handful of routes, views in Eta.
//
// Koda's contract (koda-server-setup): read x-koda-fragment, answer one URL in
// two shapes, and put `Vary: x-koda-fragment` and `x-koda: 1` on every
// response the application produces, including its own refusals.

import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appBuildPrompt, askPrompt, buildPrompt, connectAppPrompt, createCliRunner, fixPrompt, layoutsBuildPrompt, storyPrompt } from './agent.js';
import { PRELUDE_DIR, createDesign, designIdOf, findDesign, findShell, findSystem, listDesigns } from './designs.js';
import { fixSlug, listFixes } from './fixes.js';
import { datasetOf, designHostOf, eventMessages, designOrigin, handleDesignHost, isHosted, listStates, matchRoute, pickable, readPostRoutes, readRoutes, renderPath, reviewDesign, shellLayoutLinks, unbuiltLayouts } from './host.js';
import { readSnapshots, writeSnapshot, writeSnapshots } from './snapshots.js';
import { backlogOf } from './backlog.js';
import { ACROSS, acrossChanges, changesOf, createStoryWriter, fingerprintOf, hasStory, readStory, saveStory, storiesBrief, storyCount } from './build.js';
import { checkView, readCheck, readResult, resultView, screensOf, shotView, writeCheck, writeResult } from './check.js';
import { incrementOf } from './increment.js';
import { baselineOf, beforeRemoval, buildable, changedSince, createBranches, designCommitsSince, fetchRemote, filesChangedSince, gitState, gitUser, headOf, mainBranch, remoteOf, removedUnder, repositoryOf, textAt } from './branches.js';
import { DEFAULT_STACK, appOf, chooseStack, markExisting } from './app-config.js';
import { createChannels, readEvents } from './events.js';
import { createHosts, readHostConfig } from './hosts.js';
import { createRenderers } from './renderers.js';
import { checkRun, createRuns } from './runs.js';
import { canonical, cleanPath, createFolders, createReferences, refuseFolder } from './folders.js';
import { createDesignState, designChannel } from './design-state.js';
import { capture } from './capture.js';
import { DICTATION_KEY, SPEECH_MODELS, createDictation } from './dictation.js';
import { createDrafts, draftKey, sentFile } from './drafts.js';
import { createAsked } from './asked.js';
import { APP_CHANNEL, APP_LIVE, clip, createSeen, homeOf, needsOfProject, seenAt, tell, waitingOf } from './home.js';
import { createLive } from './live.js';
import { createWatches, listScreens, servePreludeFile } from './preview.js';
import { branchesOf, cleanupOf, leftBehindOf, projectOf, referenceId } from './project.js';
import { appendEntry, buildSessions, createSession, listSessions, readEntries, readSession, titleFrom, updateSession } from './sessions.js';
import { createTurns, designKey, seenKey, sessionKey, statusMessage } from './turns.js';
import { render, shaped } from './views.js';
import { changedSinceApproved, lastLineOf, notesOf, pixels, presentEntry, reviewOf, rulesOf, sizesAndClients, startedWords, whenWords } from './workspace.js';

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
    fetching: new Set(), // folder ids whose remote is being fetched, before tidying
    references: createReferences(home),
    live,
    // A turn starting or ending changes what needs the person and what's in
    // its project; one that ended while its session was on screen was seen.
    turns: createTurns({ runner, live, onChange: ({ seen, finished, watched }) => {
      if (finished && watched) app.seen.mark(seen);
      tell(app, { needs: true, projects: true });
    } }),
    seen: createSeen(home),   // the sessions the person has opened (home.js)
    waiting: null,            // how many things wait on the person, once counted (the bar)
    watches: createWatches(),
    renderers: createRenderers({ appRoot: dirname(here) }),
    hosts: createHosts({ home }),
    // The apps run from their projects' pages, apart from the design hosts (R-h2w).
    runs: createRuns({ home, onChange: () => tell(app, { running: true }) }),
    designs: createDesignState({ live }),
    channels: createChannels(),   // server events' live channels, per design (6e)
    drafts: createDrafts({ home }),          // each session's unsent message
    asked: createAsked({ home }),            // conversations about a project with no branch yet, on this machine (R-2qz)
    // The agent's own conversation, carried to another folder to resume there (agent.js).
    carry: args => runner.carry?.(args) ?? false,
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
  server.on('close', () => { app.renderers.closeAll(); app.hosts.closeAll(); app.runs.closeAll(); app.channels.closeAll(); app.dictation.closeAll(); });
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
    // A design's worktree opens its project, where its work shows (R-c7w).
    const project = folders.worktree(value) ? repositoryOf(value) : value;
    const folder = project && folders.open(project);
    if (!folder) return openForm(422, { path: value, $errors: { path: 'That folder is a design’s branch Prelude made, and it no longer belongs to a project. Open the project itself.' } });
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
    //   GET  /f/<id>/work                      Needs you, In progress and Asked lately, a region
    //   GET  /f/<id>/designs                   the designs, as ?q= and ?stage= leave them, a region
    //   GET  /f/<id>/app                       the app, a region
    //   GET  /f/<id>/designs/new               New design, in the modal over the page
    //   GET  /f/<id>/branches/<b>/publish      Push a branch: asked first, in the modal (R-k4n)
    //   GET  /f/<id>/cleanup                   Clean up, in the modal over the page (R-c3j)
    //   POST /f/<id>/cleanup                   remove what's picked: the page, and a notice
    //   POST /f/<id>/designs                   make one: its page, or the fields refused
    //   …    /f/<id>/d/fixes/<slug or new>/…   a conversation about the project, kept on this computer (handleDesign)
    //   POST /f/<id>/branches/<b>/<action>     publish; update, abandon, merge, start: the work
    //   POST /f/<id>/app/build                 start the app build: the app
    //   POST /f/<id>/app/run                   how the app runs from here (and run it): the fields, and the app
    //   POST /f/<id>/app/run/<start or stop>   run the app from here, or stop it: the app
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
      // This branch alone, and not its stories: the modal shows neither the others nor those.
      const branchNow = () => branchesOf(app, folder, { ...helpers, storiesOf: () => [], only: entry.id })[0] ?? null;
      // Pushing is always asked first, saying which branch goes to which
      // remote; nothing is pushed until the person says yes (R-k4n).
      const ask = () => {
        const branch = branchNow();
        return branch ? overlay(200, render('./projects/_publish', branch)) : redirect(res, here);
      };
      if (req.method === 'GET') return ask();

      const form = await readForm(req);
      const design = findDesign(entry.path, entry.design.split('/'))?.design ?? { id: entry.design, title: entry.design };
      // The work, with why finishing the branch failed beside it, where the
      // person clicked, and logged: the top of a long page is easily out of sight.
      // An update says there what it did, once (R-u9d).
      const work = (status, failed = null, updated = null) => {
        if (failed) console.error(`Finishing ${entry.branch} failed: ${failed}`);
        const finishError = failed ? { id: entry.id, message: failed } : null;
        if (!fragment) return failed || updated ? projectPage(status, { model: projectModel({ finishError, updated }) }) : redirect(res, here);
        return projectPart(status, 'projects/_work', { parts: { designs: false }, finishError, updated });
      };

      // Merged, the branch leaves In progress and its design is under Designs again (R-2hx).
      if (action === 'merge') {
        const merged = app.branches.merge(entry, `Merge ${entry.branch}: ${design.title} (merged by Prelude)`);
        if (merged.error) return work(409, merged.error);
        // Tidied now, so the answer has it gone; merged here, there's nothing to fetch.
        app.tidied.delete(folder.id);
        if (repository) tidyFolder(app, folder, { fetch: false });
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
        // A clash is said by the branch's merging notice instead.
        const said = updated.files ? { id: entry.id, from: updated.from, files: updated.files.length } : null;
        return work(updated.error ? 409 : 200, updated.error ?? null, said);
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

    // Run the app from here (runs.js): once it's built, from the project's own
    // folder, with a command and address of its own, never the design host's
    // (R-h2w). How it runs is saved on this computer only (R-p7c); Save and
    // run also starts it. Each answers with the app; the fields come back
    // fresh, or refused with what was typed and why.
    const runChecks = () => ({ host: readHostConfig(folder.path)?.url ?? null, prelude: req.headers.host ?? null });
    const appPart = () => (fragment
      ? send(res, 200, render('./projects/_app', projectModel({ parts: { work: false, designs: false } })))
      : redirect(res, `${here}#app`));
    if (rest === '/app/run' && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      const input = { command: String(form.get('command') ?? '').trim(), url: String(form.get('url') ?? '').trim() };
      const errors = checkRun(input, runChecks());
      if (Object.keys(errors).length) {
        const fields = { ...input, $errors: errors };
        if (fragment) return send(res, 422, render('./projects/_run-fields', fields));
        // Cold, the card shows how it runs now, with why the change was refused.
        const model = projectModel();
        return projectPage(422, { model: { ...model, app: { ...model.app, run: { ...model.app.run, $errors: errors } } } });
      }
      app.runs.save(folder, input);
      if (form.get('state') === 'starting' && appOf(folder.path).built) app.runs.start(folder, runChecks());
      tell(app, { running: true });
      if (!fragment) return redirect(res, `${here}#app`);
      const model = projectModel({ parts: { work: false, designs: false } });
      return send(res, 200, `${render('./projects/_run-fields', model.app.run)}\n${envelope('app', render('./projects/_app', model))}`);
    }
    // Clicking Run is the approval: the button shows the command it runs.
    if (rest === '/app/run/start' && req.method === 'POST' && !folder.branch) {
      if (appOf(folder.path).built) app.runs.start(folder, runChecks());
      tell(app, { running: true });
      return appPart();
    }
    if (rest === '/app/run/stop' && req.method === 'POST' && !folder.branch) {
      app.runs.stop(folder);
      tell(app, { running: true });
      return appPart();
    }

    if (rest === '' && req.method === 'GET') {
      // A design's branch isn't a project of its own (R-c7w): its project is.
      if (!folder.branch) folders.open(folder.path);
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

    // Clean up, in the modal: what Prelude leaves to the person (R-c3j).
    // Only what's picked goes: each item posts removed.<id>, a hidden false
    // before its checkbox, so the last value is the one that counts. One the
    // agent is working in never goes (R-m2e). Answered, the modal closes, the
    // page shows what's left, and the notice says what went.
    if (rest === '/cleanup' && req.method === 'GET' && !folder.branch) {
      return overlay(200, render('./projects/_cleanup', projectModel({ parts: { designs: false } })));
    }
    if (rest === '/cleanup' && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      const found = leftBehindOf(app, folder);
      const removed = {};
      for (const item of found) {
        const field = `removed.${item.id}`;
        if (!form.has(field)) continue;
        if (form.getAll(field).at(-1) !== 'true' || item.working) { removed[item.id] = false; continue; }
        const cleared = app.branches.clear(folder, item, { beforeRemove: worktree => app.hosts.stop(worktree) });
        if (cleared.error) console.error(`Cleaning up ${item.name} failed: ${cleared.error}`);
        removed[item.id] = !cleared.error;
      }
      if (Object.values(removed).some(Boolean)) tell(app, { needs: true, projects: true });
      const model = projectModel();
      const notice = render('./projects/_cleaned', { ...model, cleanup: cleanupOf(app, folder, { designs: designsHere(), removed, gone: found }) });
      if (!fragment) return projectPage(200, { model, regions: { notice: { html: notice, location: path } } });
      return send(res, 200, [envelope('modal?'), envelope('workspace', render('./projects/page', model)), envelope('notice?', notice)].join('\n'));
    }

    // New design, in the modal; ?kind= picks the design system or the shell.
    if (rest === '/designs/new' && req.method === 'GET' && !folder.branch) {
      return overlay(200, render('./projects/_new-design', projectModel()));
    }

    // A conversation about the project with no branch yet (prelude/fix-something):
    // kept on this computer, not in the project (R-2qz), so it's found there.
    // /d/fixes/new is the page that starts one. Fixed on a branch, it's in the
    // branch's worktree, and found as any fix is, below.
    if (rest.startsWith('/d/fixes/') && !folder.branch) {
      const [, slug, ...after] = rest.slice(3).split('/');
      const kept = slug === 'new' ? app.asked.fresh(folder) : app.asked.find(folder, slug);
      if (kept) return handleDesign({ req, res, url, page, app, folder, design: kept, dir: kept.dir, rest: after });
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
      // A region reloading its part is answered there in place, not moved: a
      // part from another address lands outside the region's scope, so Koda
      // gives it to the page's own region and it fills the page. What only
      // changes the draft, kept on this computer, makes no branch.
      const startsBuild = req.method === 'POST' && segments.at(-1) === 'builds';
      if (repository || (!folder.branch && startsBuild && buildable(folder.path))) {
        const onMain = findDesign(folder.path, segments);
        const onBranch = !onMain && app.branches.of(folder.id)
          .map(entry => ({ entry, found: findDesign(entry.path, segments) }))
          .find(({ entry, found }) => found?.design.id === entry.design);
        const design = onMain?.design ?? onBranch?.found?.design;
        if (design) {
          let entry = app.branches.forDesign(folder.id, design.id);
          if (!entry && req.method === 'POST' && !(onMain && changesDraftOnly(onMain.rest))) {
            const made = branchFor(design.id, design.title);
            if (made.error) return page(409, 'not-found', { what: made.error }, 'Couldn’t make the design’s branch');
            entry = made.entry;
            // Drafts are kept by folder: what was typed here goes with the design.
            app.drafts.move(folder, design, app.folders.get(entry.id), design);
          }
          if (entry) {
            if (req.method === 'GET' && !fragment) return redirect(res, `/f/${entry.id}${rest}${url.search}`);
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
//   GET  …/d/<design>                         its latest session while still open, else a new one
//   GET  …/d/<design>/sessions/new            an empty session; the first message starts it
//   POST …/d/<design>/sessions                start a session with its first message
//   GET  …/d/<design>/sessions/<id>           a session
//   POST …/d/<design>/sessions/<id>/messages  send a message
//   POST …/d/<design>/sessions/<id>/stop      stop the agent
//   GET  …/d/<design>/sessions/<id>/live      the session's live channel
//   GET  …/d/<design>/preview?screen=<id>     the design surface, showing that screen
//   GET  …/d/<design>/preview/bar?shown=<v>   the design bar alone, after the agent's changes
//   POST …/d/<design>/screen                  show a screen, in every window
//   GET  …/d/<design>/window                  the design surface alone, for a pop-out window
//   GET  …/d/<design>/live                    the design's channel: "design-changed", "files-changed"
/**
 * Whether a post to a design only changes its draft (R-d3v): what's typed,
 * its images, or a message started in the box (R-y3h). [segment] after the
 * design's id.
 */
function changesDraftOnly(rest) {
  const parts = rest[0] === 'sessions' && rest.length >= 3 ? rest.slice(2) : rest;
  if (['draft', 'attachments'].includes(parts[0])) return true;
  if (rest[0] === 'images' && rest[2] === 'markup') return true;
  return (rest[0] === 'start' && rest.length === 1) || (rest[0] === 'questions' && rest[2] === 'answer' && rest.length === 3);
}

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
 * What Prelude knows is wrong in a project, for a conversation about it to
 * start from (prelude/fix-something): a build that stopped, and a branch whose
 * pages don't render. [{ icon, title, says }].
 */
function troublesOf(app, project) {
  if (!project || project.branch) return [];
  const stopped = needsOfProject(app, project).filter(need => need.kind === 'stopped')
    .map(need => ({ icon: 'code', title: `${need.design}’s build stopped`, says: need.says }));
  const failing = app.branches.of(project.id).filter(entry => !entry.building).flatMap(entry => {
    const design = findDesign(entry.path, entry.design.split('/'))?.design ?? null;
    const state = branchState(app, entry, design);
    if (state.check !== 'failing') return [];
    return [{ icon: 'close', title: `${state.title}’s pages don’t render`, says: `${state.failures === 1 ? '1 page doesn’t' : `${state.failures} pages don’t`} render on ${entry.branch}.` }];
  });
  return [...stopped, ...failing];
}

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
  if (/^\/f\/[0-9a-f]+(\/(work|app|designs|designs\/new|cleanup|branches\/[0-9a-f]+\/publish))?\/?$/.test(pathname)) return 'app';
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
 * (here, or by a pull request on the server, squashed too), at most every 30 seconds per
 * folder. A branch tidied away changes what needs the person (R-w2k).
 *
 * With a remote, it fetches first without holding up the request (a fetch is
 * a network call, and git runs synchronously here): the page answers with
 * what it has, and once the fetch is in, whatever was tidied is said down
 * the channel, so the page's regions reload. `fetch: false` tidies now.
 */
function tidyFolder(app, folder, { fetch = true } = {}) {
  if (folder.branch || Date.now() - (app.tidied.get(folder.id) ?? 0) < app.tidyEvery) return;
  if (gitState(folder.path) !== 'repository') return;
  app.tidied.set(folder.id, Date.now());
  // Where the pushed branches' pull requests stand: one merged with commits
  // since isn't tidied, but its row changes (R-t5w).
  const pulls = () => { try { return app.branches.of(folder.id).filter(entry => entry.published).map(entry => `${entry.id}:${app.branches.pullRequest(entry, folder.path)?.state}`).join(); } catch { return ''; } };
  const tidyNow = (before = null) => {
    try {
      const notes = app.branches.tidy(folder, { fetch: false, beforeRemove: entry => app.hosts.stop({ path: entry.path }) });
      if (notes.length || (before !== null && pulls() !== before)) tell(app, { needs: true, projects: true });
    } catch { /* git couldn't say: try again next time */ }
  };
  if (!fetch || !remoteOf(folder.path)) return tidyNow();
  // One fetch at a time per project.
  if (app.fetching.has(folder.id)) return;
  app.fetching.add(folder.id);
  const before = pulls();
  // Pruned, so a branch deleted on the server isn't offered in Clean up.
  fetchRemote(folder.path, '--prune').then(() => {
    app.fetching.delete(folder.id);
    if (existsSync(folder.path)) tidyNow(before);
  });
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
  let tip = entry?.branch;
  if (entry) {
    try {
      repo = entry.repo ?? app.folders.get(entry.parentId)?.path ?? null;
      const base = repo && baselineOf(repo, entry.branch);
      if (base) increment = incrementOf({ repo, base, designId: design.id, designDir: dir, ext });
      const status = app.branches.status(entry);
      shared = status.alsoChanges;
      tip = status.tip;
    } catch { /* git couldn't say: whole pages, as without a branch */ }
  }
  // Built as of a build's commit, and the design not changed since (step 10).
  const builtSince = key => {
    const builtAt = entry?.built?.[key];
    return Boolean(builtAt && repo && designCommitsSince(repo, builtAt, tip, design.id).length === 0);
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
/**
 * Start a conversation's first session with what the person sent from Ask or
 * fix (prelude/fix-something), as its own page does when its first message is
 * sent: `design` is the conversation just made, `fields` the form's.
 */
async function startConversation({ req, res, page, app, folder, design, fields }) {
  const sessionsUrl = `/f/${folder.id}/d/${design.id}/sessions`;
  const body = Readable.from([Buffer.from(new URLSearchParams(fields).toString())]);
  const first = Object.assign(body, { method: 'POST', url: sessionsUrl, headers: { ...req.headers, 'content-type': 'application/x-www-form-urlencoded' } });
  return handleDesign({ req: first, res, url: new URL(sessionsUrl, 'http://localhost'), page, app, folder, design, dir: design.dir, rest: ['sessions'] });
}

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
  // The folder this design's folder belongs to: itself, or (in a design's
  // worktree) the repository it's a branch of. What the agent may read, and
  // where finishing happens, are the folder's.
  const parentId = folder.branch?.parentId ?? folder.id;
  const entry = folder.branch?.design === design.id ? folder.branch : null;
  // A conversation about the project with no branch yet (prelude/fix-something):
  // kept on this computer (asked.js), and its agent only reads (R-h7w).
  // `starting` is Ask or fix, the page that starts one.
  const kept = Boolean(design.kept);
  const starting = kept && design.slug === 'new';
  // A sent image's file, from the path its transcript keeps.
  const fileOf = file => sentFile(folder, design, dir, file);

  // --- the design page's model (prelude/design-workspace; server/workspace.js)

  const routes = hosted ? readRoutes(dir) : [];
  const states = hosted ? listStates(dir) : [];
  const stateOn = () => states.find(s => s.id === designs.state(dKey)) ?? states[0] ?? null;
  const datasetFor = state => datasetOf(app, dKey, dir, state);
  const context = { base, routes, states, datasetOf: datasetFor };
  // How the pages show transcript entries, pushed or rendered.
  const view = { present: item => presentEntry(item, context), base };

  // A window's way of looking at the design (its size and its client), from
  // a form's fields or a URL's query: the design's forms post surface.view
  // and the like; anything else may say view, size, client. The real app
  // isn't shown here: it opens in its own window, from a build session.
  const lookingOf = get => ({
    view: viewOf(get('surface.view') ?? get('view')),
    size: String(get('surface.size') ?? get('size') ?? 'fit'),
    client: get('surface.client') ?? get('client') ?? null,
  });
  const fromForm = form => lookingOf(name => (form.has(name) ? String(form.get(name)) : null));
  const fromQuery = () => lookingOf(name => url.searchParams.get(name));

  /**
   * The design surface, as one window shows it. The page and the state on
   * show are the design's (R-c2m); the size and the client are the
   * window's. Sizes and clients are the shell's (R-h9x), the custom size the
   * design's. `showing` takes the "a state's file changed" notice, which is
   * said once.
   */
  const surfaceOf = ({ view: shown = 'inline', size = 'fit', client = null, notice = null, showing = false } = {}) => {
    const { sizes, clients } = sizesAndClients(folder.path);
    const custom = designs.custom(dKey);
    const reset = showing ? designs.takeReset(dKey) : null;
    const common = {
      view: shown,
      size,
      client: clients.some(c => c.id === client) ? client : clients[0].id,
      ...(custom ? { custom } : {}),
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
    if (entry?.building) return { step: 'building', label: `Building ${entry.building.title}`, next: 'checked against the approved design' };
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

  /** The design's own sessions, newest first: a build session is Build's (prelude/build). */
  const designSessions = () => listSessions(dir).filter(item => !item.build);

  /**
   * The design page's model (DesignPage, server/workspace.js), for a session
   * or a new one. `surface` is the window's way of looking (surfaceOf).
   */
  const pageModel = ({ session = null, surface = {}, showing = false, extra = {} } = {}) => {
    // A build session's chat lists the design's build sessions; the design
    // page's, its design sessions only: builds are listed under Build.
    const all = session?.build ? listSessions(dir).filter(item => item.build) : designSessions();
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
      // A fix's changed designs (step 11), from what's committed on its branch.
      changes: design.kind === 'fix' ? (() => {
        const changed = branchOf()?.alsoChanges ?? [];
        return listDesigns(folder.path).filter(other => changed.some(path => path.startsWith(`${PRELUDE_DIR}/${other.id}/`)))
          .map(other => ({ title: other.title, url: `/f/${folder.id}/d/${other.id}` }));
      })() : null,
      merged: merged && { branch: merged.branch, into: merged.into, when: whenWords(merged.at) },
      branch: branchOf(),
      sessions: all.map((item, i) => ({
        id: item.id,
        title: item.title,
        started: startedWords(item.startedAt),
        // Where the latest session ended, for "Carry on from…" (R-e9t).
        ...(i === 0 && !session?.build ? { lastLine: lastLineOf(readEntries(dir, item.id)) } : {}),
      })),
      session: session && { id: session.id, title: session.title },
      state: turnOf(session),
      entries: session ? readEntries(dir, session.id).map(view.present) : [],
      // What the agent is writing now, so the transcript ends with it.
      streaming: session ? turns.streaming(folder, design, session.id) : null,
      rules: rulesOf(dir, context),
      questions: notes.questions,
      decisions: notes.decisions,
      dictation: app.dictation.state(),
      speechModels: SPEECH_MODELS,
      queued: queuedOf(session?.id),
      images: [],
      draft: draftOf(session?.id ?? null),
      surface: surfaceModel,
      stage: stageOf(surfaceModel.review),   // where the design stands, for the header (10.9)
      // What's wrong in the project, for a fix's starting points (prelude/fix-something).
      ...(design.kind === 'fix' ? { troubles: troublesOf(app, app.folders.get(parentId)) } : {}),
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
    // From the entries it rendered, and the words it shows being written, if any.
    const live = session
      ? `${base}/sessions/${session.id}/live?from=${model.entries.length}${model.streaming ? `&streaming=${encodeURIComponent(model.streaming.id)}` : ''}`
      : `${base}/live`;
    const body = render('./_session', { ...model, live });
    // In the app layout, like Prelude's other pages: the page brings its own
    // stylesheet and asks to fill the window, so Koda swaps it in from Home
    // as a fragment. From a page still in ds/v1 it comes whole (askedFromLayout).
    if (fragment && askedFromLayout(req, 'app') && !Object.keys(regions).length) return send(res, status, body);
    return send(res, status, render('./layout', { body, path, title, regions, system: true }));
  };

  /**
   * An overlay (a drawer or a modal over the page): alone for a fragment
   * request; a cold load gets the page beneath - the latest design session -
   * with the overlay in its region.
   */
  const overlay = (name, data, region) => {
    const html = render(`./${name}`, data);
    if (fragment) return send(res, 200, html);
    const latest = designSessions()[0] ?? null;
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

  // The design bar alone, reloading when the agent changes the design
  // (files-changed): `shown` is the version the window's frame loaded, so
  // the bar can say it's behind (R-v2q).
  if (req.method === 'GET' && rest[0] === 'preview' && rest[1] === 'bar' && rest.length === 2) {
    const shown = Number.parseInt(url.searchParams.get('shown') ?? '', 10);
    const body = render('./_design-bar', { ...basics(), rules: rulesOf(dir, context), surface: surfaceOf({ ...fromQuery(), showing: true }), ...(Number.isNaN(shown) ? {} : { shown }) });
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

  // Capture (R-w8p, R-3qz): the page where the frame is now - a page reached
  // by its links, a drawer or modal open over it - in this window's state,
  // size and client, as a picture, into the message box of the
  // session the chat shows. Every chat reloads its tray on draft-changed.
  // The desktop app posts its own picture of the frame as it is on screen
  // (`picture`, desktop.js), kept as it is; otherwise the page is opened
  // afresh at its address, without what's typed.
  if (req.method === 'POST' && rest[0] === 'capture' && rest.length === 1) {
    const form = await readForm(req);
    const looking = fromForm(form);
    const answer = (data, also = '') => sendView(200, '_captured', data, also);
    const page = String(form.get('page') ?? '');
    const known = hosted ? Boolean(matchRoute(routes, page)) : listScreens(dir).some(screen => screen.file === page);
    if (!known) return answer({ error: 'That page is no longer in the design.' });
    // Where the frame is (its page says, _surface.eta): opened instead of the
    // page picked when it's an address the design answers, an overlay over
    // its page as a deep link is.
    const where = String(form.get('frame.at') ?? '');
    const whereRoute = hosted && where.startsWith('/') ? matchRoute(routes, new URL(where, 'http://localhost').pathname)?.route : null;
    const target = whereRoute ? where : page;
    const whole = form.get('whole') === 'true';
    const posted = form.get('picture');
    const picture = !whole && posted && typeof posted === 'object' && posted.size ? Buffer.from(await posted.arrayBuffer()) : null;
    let bytes;
    if (picture) {
      if (!picture.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return answer({ error: 'The window’s picture of the page wasn’t a PNG.' });
      bytes = picture;
    } else {
      const { sizes, clients } = sizesAndClients(folder.path);
      const size = looking.size === 'custom' ? designs.custom(dKey) : sizes.find(candidate => candidate.id === looking.size && candidate.width);
      const measured = value => { const n = Math.round(Number(value)); return n >= 50 && n <= 8000 ? n : null; };
      const width = size?.width ?? measured(form.get('frame.width')) ?? 1280;
      const height = size?.height ?? measured(form.get('frame.height')) ?? 800;
      const client = clients.find(candidate => candidate.id === looking.client) ?? clients[0];
      const at = hosted ? `${designOrigin(req, folder, design)}${target}` : `${previewOrigin(req)}/f/${folder.id}/p/${design.id}/screens/${encodeURIComponent(page)}`;
      try {
        bytes = await capture({ url: at, width, height, whole, attributes: client.attributes ?? {} });
      } catch (error) {
        return answer({ error: `Couldn’t capture the page: ${error.message}` });
      }
    }
    const session = sessionOnShow();
    // Named after the page where the frame was, when it's another.
    const said = String(form.get('name') ?? '').trim();
    const looks = said.split(' – ').slice(1);
    const name = (whereRoute?.title && target !== page ? (looks.length ? [whereRoute.title, ...looks].join(' – ') : `${whereRoute.title}.png`) : said) || 'Capture.png';
    const added = app.drafts.addImage(folder, design, session?.id ?? null, { name, bytes });
    if (added.error) return answer({ error: added.error });
    live.publish(designChannel(dKey), 'draft-changed');
    const draft = draftOf(session?.id ?? null);
    return answer(draft.attachments.at(-1), envelope('attachments?', render('./_attachments', draft)));
  }

  if (req.method === 'GET' && rest[0] === 'window' && rest.length === 1) {
    // The design, as the page has it: what the agent is writing now in the
    // session the chat shows, too (DesignPage.streaming).
    const session = sessionOnShow();
    const body = render('./_window', {
      ...basics(),
      rules: rulesOf(dir, context),
      streaming: session ? turns.streaming(folder, design, session.id) : null,
      surface: surfaceOf({ ...fromQuery(), view: 'window', showing: true }),
    });
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
    for (const image of gone?.images ?? []) rmSync(fileOf(image.file), { force: true });
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
          // The app build and the shell's layouts have no screens of their
          // own: whether the app starts from the branch is their check, beside
          // the chat (prelude/build). One that doesn't start isn't rendered from.
          const started = ['app', 'layouts'].includes(buildKind(session)) ? await startApp(session) : null;
          const approveHere = 'this repository’s design host needs your approval first. Approve and start the app beside the chat, then send the next message.';
          if (started?.status === 'unapproved' && !isHosted(dir)) return { blocked: `Prelude didn’t start the app: ${approveHere}` };
          if (!isHosted(dir) || started?.status === 'fails') return null;
          // A build turn may have changed the app's code, not just its views:
          // start its host afresh, so the check builds and renders what's there now.
          if (session?.build && !started) app.hosts.stop(folder);
          // A host waiting for the person's approval is nobody's failure.
          const host = readHostConfig(folder.path);
          if (host && !app.hosts.approved(folder, host)) {
            return { blocked: `Prelude didn’t check the pages: ${session?.build ? approveHere : 'this repository’s design host needs your approval first. Approve it in the design bar, then send the next message.'}` };
          }
          const review = await reviewDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design, designDir: dir });
          const result = { failures: review.failures, rendered: [...review.renders.values()].filter(Boolean).length, differ: review.differ, warnings: review.warnings, ahead: review.ahead };
          // A page's build session shows every screen's status beside the chat (R-9xe).
          if (buildKind(session) === 'page') checkDone(session, review);
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
      recap: carriedOver(session)?.recap ?? null,
      preface: [carriedOver(session)?.preface, entry ? (() => {
        const merging = (() => { try { return app.branches.merging(entry); } catch { return null; } })();
        if (merging?.unresolved.length) {
          return `(From Prelude, not the person: ${merging.from} is half brought into this branch, and these files clash: ${merging.unresolved.join(', ')}. Each holds both versions between git's conflict markers (<<<<<<< this branch, ======= then ${merging.from}, >>>>>>>). Resolve every one before anything else: keep what ${merging.from} has, put this branch's change on top of it, drop anything ${merging.from} already does, and remove every marker. Prelude commits the merge after your turn once no marker is left.)`;
        }
        const files = app.branches.takeCameIn(entry);
        return files ? `(From Prelude, not the person: the main branch was brought into this branch, and these files came in: ${files.slice(0, 30).join(', ')}${files.length > 30 ? ', …' : ''}. Take them into account.)` : null;
      })() : null].filter(Boolean).join('\n\n') || null,
      afterTurn: entry ? ({ message }) => afterBranchTurn(session, message) : null,
      ...buildContext(session, references),
      ...fixContext(references),
      ...askContext(references),
    };
  };

  // A session that began as a conversation with no branch, and moved onto
  // the fix's branch (R-x8d). Its first turn there resumes the agent's own
  // conversation, carried to the worktree, told only that it can change the
  // project now. One that couldn't be carried, or can't be resumed after all
  // (`recap`), starts afresh, told what was said. { preface, recap }, or null.
  const carriedOver = session => {
    if (!session?.carried) return null;
    const now = `It's now fixed on ${entry?.branch ?? 'its branch'}, and you can change the project, as your instructions now say.`;
    const recap = recapOf(session, now);
    return session.started
      ? { preface: `(From Prelude, not the person: this conversation began before it had a branch, when you could only read. ${now})`, recap }
      : { preface: recap, recap: null };
  };

  // What was said so far in a session, for an agent starting afresh: the
  // person's words and the agent's, newest kept when it's long.
  const recapOf = (session, now) => {
    const said = readEntries(dir, session.id)
      .filter(item => (item.type === 'user' || item.type === 'text') && String(item.text ?? '').trim())
      .map(item => `${item.type === 'user' ? 'The person' : 'You'}: ${clip(String(item.text).trim(), 2000)}`);
    const kept = [];
    let length = 0;
    for (const line of [...said].reverse()) {
      if (length + line.length > 24000) break;
      kept.unshift(line);
      length += line.length;
    }
    const cut = kept.length < said.length ? ` The start is left out here; the whole of it is in ${PRELUDE_DIR}/${design.id}/sessions/${session.id}/transcript.jsonl.` : '';
    return `(From Prelude, not the person: this conversation began before it had a branch, when you could only read, and you're starting afresh on it here. ${now} What was said so far:${cut}\n\n${kept.join('\n\n')})`;
  };

  // A conversation with no branch yet (prelude/fix-something): the agent only
  // reads (R-h7w), and may read the conversation's own folder, where the
  // person's images are kept. Nothing is committed: there's no branch.
  const askContext = references => {
    if (!kept) return {};
    const config = readHostConfig(folder.path);
    const project = appOf(folder.path);
    const reading = [...references, { name: 'This conversation', path: dir }];
    return {
      mode: 'ask',
      shared: [],
      references: reading,
      check: null,
      systemPrompt: askPrompt({ designs: listDesigns(folder.path), app: project, references: reading, stack: config && { ext: config.views, guide: config.guide }, kodaPath: kodaPackage }),
    };
  };

  // A fix (step 11): its own instructions, the app and every design to
  // change, and a check over the designs it has touched so far - those whose
  // files changed, and those whose built pages use an app file that changed.
  // Pages that don't render are told to the agent; pages that differ are
  // listed per design, for the person to look at there and approve again.
  const fixContext = references => {
    if (design.kind !== 'fix' || !entry) return {};
    const config = readHostConfig(folder.path);
    const project = appOf(folder.path);
    const designs = listDesigns(folder.path);
    return {
      mode: 'fix',
      shared: [],
      systemPrompt: fixPrompt({ title: design.title, fixPath: `${PRELUDE_DIR}/${design.id}`, designs, app: project, branch: entry.branch, references, stack: config && { ext: config.views, guide: config.guide }, kodaPath: kodaPackage }),
      check: async () => {
        const changed = changedSince(entry.path, entry.base);
        const designFile = path => !/\/(sessions|snapshots)\//.test(path);
        const touched = listDesigns(folder.path).filter(other => {
          const otherDir = join(folder.path, PRELUDE_DIR, ...other.id.split('/'));
          if (!isHosted(otherDir)) return false;
          if (changed.some(path => path.startsWith(`${PRELUDE_DIR}/${other.id}/`) && designFile(path))) return true;
          const appViews = [...readRoutes(otherDir).map(route => route.view), ...readPostRoutes(otherDir).flatMap(post => [post.form, post.answer.view, ...post.answer.also.map(also => also.view)])]
            .filter(view => typeof view === 'string' && view.startsWith('@app/')).map(view => view.slice(5));
          return appViews.some(view => changed.some(path => path === view || path.startsWith(`${view}.`)));
        });
        if (!touched.length) return null;
        // The app's code may have changed: its host starts afresh.
        if (config) {
          app.hosts.stop(folder);
          if (!app.hosts.approved(folder, config)) {
            return { blocked: 'Prelude didn’t check the pages: this repository’s design host needs your approval first. Approve it on a design’s page, then send the next message.' };
          }
        }
        const result = { failures: [], rendered: 0, differ: [], warnings: [], ahead: [], designs: [], differDesigns: [] };
        for (const other of touched) {
          const otherDir = join(folder.path, PRELUDE_DIR, ...other.id.split('/'));
          const url = `/f/${folder.id}/d/${other.id}`;
          const review = await reviewDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design: other, designDir: otherDir });
          result.designs.push({ title: other.title, url });
          result.failures.push(...review.failures.map(failure => ({ ...failure, path: `${other.title} (prelude/${other.id}): ${failure.path}`, url })));
          result.rendered += [...review.renders.values()].filter(Boolean).length;
          if (review.differ.length) result.differDesigns.push({ title: other.title, url, count: review.differ.length });
        }
        return result;
      },
    };
  };

  // Whether what a build session builds is built now: the app, the shell's
  // layouts, the design-wide rules, or a page of the design.
  const builtNow = build => Boolean(build.group === APP_GROUP.key ? appOf(folder.path).built
    : build.group === LAYOUTS_GROUP.key ? shellLayoutsOf(folder.path)?.unbuilt.length === 0
    : build.group === ACROSS.key ? !backlogOf(dir).designWide.some(rule => rule.proposed)
    : backlogOf(dir).groups.find(g => g.key === build.group)?.built);

  // After a turn on a design's branch: tidy what building made redundant,
  // commit the turn, and finish the build once its group is built. What's
  // next after a build turn is on its session's page (prelude/build), not
  // in the transcript.
  const afterBranchTurn = (session, message) => {
    const build = session?.build;
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
    const wasMerging = app.branches.merging(entry);
    const commit = app.branches.commit(entry, `${build ? build.title : design.title}: ${message.split('\n')[0].slice(0, 60)}`);
    // An update that clashed: committed once the agent has resolved every file, else said what's left.
    const stillMerging = wasMerging && app.branches.merging(entry);
    if (stillMerging?.unresolved.length) {
      return { type: 'note', failed: true, text: `${stillMerging.from} is still half brought in: ${stillMerging.unresolved.join(', ')} still ${stillMerging.unresolved.length === 1 ? 'has' : 'have'} conflict markers, so nothing was committed. Ask the agent to resolve ${stillMerging.unresolved.length === 1 ? 'it' : 'them'}, or abandon the update.` };
    }
    const finishedMerge = wasMerging && commit ? ` That finishes bringing ${wasMerging.from} in: every clash is resolved.` : '';
    if (build && builtNow(build)) {
      app.branches.building(entry, null);
      // Built as of this commit: a later design change makes it due again (step 10).
      app.branches.markBuilt(entry, build.group);
    }
    return commit && { type: 'note', text: `Committed to ${entry.branch} (${commit}).${finishedMerge}` };
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
    const changed = changedSinceApproved(dir);
    return {
      id: design.id,
      title: design.title,
      folder: project,
      base,
      branch: entry?.branch ?? null,
      // There's an app once main (or this folder) has one; it's built into once this branch has it.
      app: { built: appHere.built || appOnMain.built, onBranch: appHere.built, stack: appHere.stack ?? appOnMain.stack ?? '', url: `/f/${parentId}#app` },
      // Builds wait for approved screens (10.9), of the design as it is now:
      // changed since, it's approved again first. The Build page offers Approve.
      approved: Boolean(readSnapshots(dir)?.size) && !changed,
      changed,
      building: building && { group: building.slug, title: building.title, session: sessionOf(building.key) ?? { title: building.title, url: base } },
      writing: app.stories.writingAll(dir),
      updateUrl: entry ? `/f/${parentId}/branches/${entry.id}/update` : null,
      groups: toBuild.map(group => groupView(group, { project, session: sessionOf(group.key) })),
      unchanged: groups.filter(group => !group.toBuild && group.key !== ACROSS.key).map(group => ({ title: group.title })),
      // Every build session of the design, newest first: they're Build's, not the design page's.
      sessions: listSessions(dir).filter(session => session.build).map(session => ({ title: session.title, url: `${base}/sessions/${session.id}`, started: startedWords(session.startedAt) })),
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
   * What a build session builds, so what its page shows beside the chat
   * (prelude/build): 'page', a page of the design, with the check; 'app' or
   * 'layouts', the app itself or the shell's layouts, which have no screens
   * of their own, with what the build did. Null for a design session.
   */
  function buildKind(session) {
    if (!session?.build) return null;
    return session.build.group === APP_GROUP.key ? 'app' : session.build.group === LAYOUTS_GROUP.key ? 'layouts' : 'page';
  }

  /**
   * Whether the app starts from this branch, for the app build and the
   * shell's layouts build: started afresh, as the turn may have changed its
   * code, and kept with the session (result.json). "Starts" is that it
   * answered Prelude in time, not that every page of it works. The page
   * hears check-done down the session's channel. { status, log? }.
   */
  async function startApp(session) {
    const config = readHostConfig(folder.path);
    let start;
    if (!config || !appOf(folder.path).built) start = { status: 'none' };
    else if (!app.hosts.approved(folder, config)) start = { status: 'unapproved' };
    else {
      app.hosts.stop(folder);
      try {
        await app.hosts.start(folder, config);
        start = { status: 'starts' };
      } catch (error) {
        start = { status: 'fails', log: String(error?.message ?? error) };
      }
    }
    writeResult(dir, session.id, { at: new Date().toISOString(), start });
    tell(app, { projects: true });
    live.publish(sessionKey(folder, design, session.id), 'check-done');
    return start;
  }

  /** A build session's check as it last ran (check.js); before its first, as the build found it. */
  function checkOf(session) {
    return readCheck(dir, session.id) ?? { at: session.startedAt, shots: screensOf(dir, session.build.title) };
  }

  /**
   * What an app or layouts build did (Result, check.js): its last start,
   * the files changed since the session started (or, for one from before
   * Prelude noted that, since the branch began), and the shell's layouts.
   */
  function resultOf(session, url) {
    const changes = session.from ? { since: 'session', files: filesChangedSince(folder.path, session.from) }
      : entry?.base ? { since: 'branch', files: filesChangedSince(folder.path, entry.base) }
      : { since: 'branch', files: [] };
    const shell = buildKind(session) === 'layouts' ? shellLayoutsOf(folder.path) : null;
    const layouts = shell && [
      ...Object.entries(shell.links).map(([name, file]) => ({ name, file: String(file).replace(/^@app\//, '') })),
      ...shell.unbuilt.map(name => ({ name, file: null })),
    ].sort((a, b) => a.name.localeCompare(b.name));
    return resultView(readResult(dir, session.id), { url, changes, layouts });
  }

  /**
   * A build session's page (BuildSession, check.js): where it builds, the
   * page's stories counted, the app on this branch, what the agent is doing,
   * what's next, and beside the chat the check (a page's build) or what the
   * build did (the app's, the shell's layouts'). While Prelude checks after
   * a turn, the agent isn't working.
   */
  function buildSessionView(session) {
    const url = `${base}/sessions/${session.id}`;
    const kind = buildKind(session);
    const project = { id: parentId, name: folder.branch?.parentName ?? folder.name };
    const slug = session.build.group === ACROSS.key ? ACROSS.slug : backlogOf(dir).groups.find(group => group.key === session.build.group)?.slug;
    const running = entry && appRunning(app, entry);
    const config = running && readHostConfig(folder.path);
    const state = turns.state(folder, design, session.id);
    let into = 'main';
    try { if (entry) into = app.branches.status(entry).into; } catch { /* git couldn't say */ }
    return {
      id: session.id,
      title: session.title,
      url,
      kind,
      folder: { id: project.id, name: project.name, url: `/f/${project.id}` },
      design: { id: design.id, title: design.title, url: base },
      branch: entry?.branch ?? '',
      build: { title: session.build.title, stories: slug ? storyCount(dir, slug) : 0 },
      app: running ? { running: running.running, approved: running.approved, command: config?.start ?? '', url: running.url, open: running.open, start: `${url}/app/start`, back: url } : null,
      status: state.kind === 'working' ? { says: state.step?.says ?? 'Working…' } : null,
      // What's next (10.7): shown to the person, never told to the agent.
      next: { built: builtNow(session.build), finish: { url: `/f/${parentId}`, label: entry && remoteOf(entry.path) ? 'Push and open a pull request' : `Merge into ${into}` } },
      check: kind === 'page' ? checkView(checkOf(session), { url: `${url}/check`, building: session.build.title }) : null,
      result: kind === 'page' ? null : resultOf(session, `${url}/result`),
    };
  }

  /**
   * A build session's page, in the app layout like the Build page: the
   * design page's chat (its model, listing the design's build sessions) and
   * its channel, beside the check or what the build did.
   */
  function buildSessionPage(status, session) {
    designs.showSession(dKey, session.id);
    const chat = pageModel({ session });
    const live = `${base}/sessions/${session.id}/live?from=${chat.entries.length}${chat.streaming ? `&streaming=${encodeURIComponent(chat.streaming.id)}` : ''}`;
    const body = render('./build/session', { ...buildSessionView(session), chat, live });
    if (fragment && askedFromLayout(req, 'app')) return send(res, status, body);
    return send(res, status, render('./layout', { body, path: `${base}/sessions/${session.id}`, title: `${session.build.title} · Build · ${title}`, layout: { live: APP_LIVE, needsYou: waitingOf(app) }, system: true }));
  }

  /**
   * A build turn's check has run, over every screen of the design (R-9xe):
   * each screen's status is kept with the session, and its page hears
   * check-done down the session's channel, which reloads the check, with
   * the tally afresh.
   */
  function checkDone(session, review) {
    writeCheck(dir, session.id, { at: new Date().toISOString(), shots: screensOf(dir, session.build.title, review) });
    const key = sessionKey(folder, design, session.id);
    live.publish(key, 'check-done');
    live.publish(key, envelope('check-tally?', render('./build/_tally', buildSessionView(session).check)).trim());
  }
  /**
   * Start a turn in a session with the person's messages: one, or those that
   * waited, together in the order written (R-z4k). Each item: { text,
   * images, lookingAt, prompt } (prompt: what the agent is told).
   */
  const startTurn = (session, items) => {
    const started = turns.start({
      folder, design, designDir: dir, sessionId: session.id,
      message: items.map(item => item.prompt).join('\n\n'),
      shown: items.map(({ text, images, lookingAt }) => ({ text, images, lookingAt })),
      stopUrl: `${base}/sessions/${session.id}/stop`,
      view,
      onIdle: sendWaiting,
      ...agentContext(session),
    });
    // Carried onto a fix's branch: told so once, with its first turn there.
    if (!started.error && session.carried) updateSession(dir, session.id, { carried: false });
    return started;
  };

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
    if (![APP_GROUP.key, LAYOUTS_GROUP.key].includes(group.key)) {
      if (!readSnapshots(dir)?.size) return refuse('Approve the design first: a build is checked against its approved screens, so there has to be something to check against.');
      if (changedSinceApproved(dir)) return refuse('The design changed since you approved it. Look at what’s different on the design’s page, and approve it again before building: a build is checked against the approved screens.');
    }
    if (!isApp && entry.building && entry.building.group !== key && work.some(g => g.key === entry.building.group && g.toBuild)) {
      return refuse(`This design is building ${entry.building.title} now. Groups are built one at a time.`);
    }
    if (turns.state(folder, design, null).kind !== 'idle') return refuse('The agent is working on this design. Wait for it to finish.');
    app.branches.building(entry, group);
    const connecting = isApp && appOf(folder.path).existing;
    const message = connecting ? 'Connect the app.' : isApp ? 'Build the app.' : group.key === LAYOUTS_GROUP.key ? 'Build the shell’s layouts.' : `Build ${group.title}.`;
    const made = createSession(dir, { title: connecting ? 'Connect the app' : isApp ? 'Build the app' : `Build: ${group.title}`, build: { group: group.key, title: group.title } });
    // Where the branch was when it started: what the build changed is since then.
    const session = updateSession(dir, made.id, { from: headOf(folder.path) }) ?? made;
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${base}/sessions/${session.id}/stop`, view, onIdle: sendWaiting, ...agentContext(session) });
    if (started.error) return refuse(started.error);
    return redirect(res, `${base}/sessions/${session.id}`);
  }

  const [section, sessionId, action, ...extra] = rest;
  // A build session's check, result and app go deeper (…/check/:shot/approve, …/result/fix, …/app/start).
  const deeper = section === 'sessions' && ['check', 'result', 'app'].includes(action);
  if (extra.length > 0 && !deeper) return notFound();

  // The page: a session, or - with none yet, or asked for - a new one.
  const sessionPage = (status, session, extraModel = {}) => {
    designs.showSession(dKey, session?.id ?? 'new');
    return designPage(status, pageModel({ session, showing: true, extra: extraModel }), { session });
  };

  // Whether a session still has the person's attention (R-o4s): the agent is
  // working in it, or a turn ended there in the last week that they haven't
  // opened it since (as Home's Needs you counts it; seen.json forgets a week).
  const stillOpen = session => {
    if (['working', 'checking'].includes(turns.state(folder, design, session.id).kind)) return true;
    const turn = readEntries(dir, session.id).findLast(item => item.type === 'turn');
    if (!turn || turn.stopped || !(Date.parse(turn.at) > Date.now() - 7 * 24 * 60 * 60 * 1000)) return false;
    const seenWhen = seenAt(app.seen.all(), folder, design, session.id);
    return !(seenWhen && seenWhen >= turn.at);
  };

  // A fix's page is at its own address (prelude/fix-something): its latest
  // session, or Ask or fix's new one. A design's goes to its latest session
  // while that's still open, and is otherwise a new session, with its
  // starting points (R-o4s). Its latest is never a build session: those are
  // Build's (prelude/build).
  if (section === undefined && req.method === 'GET') {
    const latest = starting ? null : designSessions()[0];
    if (latest && design.kind !== 'fix') {
      return stillOpen(latest) ? redirect(res, `${base}/sessions/${latest.id}`) : sessionPage(200, null);
    }
    if (latest) {
      app.seen.mark(seenKey(folder, design, latest.id));
      tell(app, { needs: true });
    }
    return sessionPage(200, latest ?? null);
  }

  // A conversation about the project (prelude/fix-something): Rename it, on a
  // branch or not, and Fix it on a branch while it has none. Each asks in the
  // modal; refused, only the fields come back, or the page with them on a cold load.
  if (design.kind === 'fix' && !starting && ['rename', 'branch'].includes(section) && sessionId === undefined) {
    const fieldsView = section === 'rename' ? '_rename-fields' : '_fix-branch-fields';
    if (section === 'branch' && !kept) return redirect(res, base);
    const ask = (status, fields = null) => {
      const html = render(`./_${section === 'rename' ? 'rename' : 'fix-branch'}`, { ...pageModel(), ...(fields ? { $fields: fields } : {}) });
      if (fragment) return send(res, status, html);
      const latest = listSessions(dir)[0] ?? null;
      designs.showSession(dKey, latest?.id ?? 'new');
      return designPage(status, pageModel({ session: latest, showing: true }), { session: latest, regions: { modal: { html, location: url.pathname } }, path: base });
    };
    if (req.method === 'GET') return ask(200);
    if (req.method !== 'POST') return notFound();
    const form = await readForm(req);
    const title = String(form.get('title') ?? '').trim();
    const refuse = (status, error) => {
      const fields = { title: String(form.get('title') ?? ''), branch: branchOf()?.branch, $errors: { title: error } };
      return fragment ? sendView(status, fieldsView, fields) : ask(status, fields);
    };
    if (!title) return refuse(422, 'This is required.');

    // Renamed: the person's name from now on (R-m5c). On a branch, the branch
    // keeps its name (R-j3v): only the fix's title changes.
    if (section === 'rename') {
      if (kept) app.asked.rename(folder, design.slug, title);
      else {
        const file = join(dir, 'fix.json');
        let meta = {};
        try { meta = JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { /* a fix.json is remade */ }
        writeFileSync(file, JSON.stringify({ ...meta, title, named: true }, null, 2) + '\n');
        if (entry && !turns.busy(folder, design)) {
          try { app.branches.commit(entry, `${title}: renamed (committed by Prelude)`); } catch (error) { console.error(error); }
        }
      }
      tell(app, { projects: true });
      return redirect(res, base);
    }

    // Fix it on a branch (R-x8d): the branch is named after the fix's name,
    // made from main in a worktree of its own (a folder that isn't a
    // repository becomes one). The conversation moves onto it, sessions,
    // drafts and all, and leaves Asked lately for In progress.
    if (turns.busy(folder, design)) return refuse(409, 'The agent is still answering. Wait for it to finish, or stop it, first.');
    const taken = new Set([
      ...listFixes(folder.path).map(fix => fix.slug),
      ...app.branches.of(folder.id).filter(other => other.design.startsWith('fixes/')).map(other => other.design.slice(6)),
      ...app.asked.list(folder).filter(other => other.slug !== design.slug).map(other => other.slug),
    ]);
    const slug = fixSlug(title, taken);
    if (!slug) return refuse(422, 'The name needs at least one letter or digit.');
    const made = app.branches.ensure({ folder, designId: `fixes/${slug}`, title });
    if (made.error) return refuse(409, made.error);
    const worktree = app.folders.get(made.entry.id);
    const moved = app.asked.moveOnto(folder, design.slug, made.entry.path, { title, slug });
    app.drafts.move(folder, design, worktree, moved.fix);
    // The agent carries on where it left off, in the worktree; one whose
    // conversation can't be carried starts afresh there, told what was said.
    for (const session of moved.sessions) {
      if (!app.carry({ sessionId: session.claudeSessionId, from: folder.path, to: made.entry.path })) {
        updateSession(moved.dir, session.id, { claudeSessionId: randomUUID(), started: false });
      }
    }
    const newest = listSessions(moved.dir)[0];
    if (newest) appendEntry(moved.dir, newest.id, { type: 'note', text: `Fixing this on ${made.entry.branch}, made from ${mainOf(folder)}. The agent can change the project there now; each turn is committed to the branch.` });
    app.branches.commit(made.entry, `${title}: a fix, from a conversation about the project (committed by Prelude)`);
    tell(app, { needs: true, projects: true });
    return redirect(res, `/f/${worktree.id}/d/${moved.fix.id}`);
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
    images.length ? `(The person attached ${images.length === 1 ? 'an image' : `${images.length} images`} to this message. Read ${images.length === 1 ? 'it' : 'them'}: ${images.map(image => (kept ? fileOf(image.file) : image.file)).join(', ')}.)` : null,
    lookingAt?.said ?? null,
  ].filter(Boolean).join('\n\n');

  // Ask or fix's first message (prelude/fix-something): the conversation is
  // made on this computer (R-2qz), named from the message's first words
  // (R-m5c), and its first session starts there, with what was in the box.
  if (starting && sessionId === undefined && req.method === 'POST') {
    const form = await readForm(req);
    const said = messageOf(form, null);
    if (!said.text && !said.ids.length) {
      return sessionPageComposer(422, null, { message: '', $errors: { message: 'This is required.' } });
    }
    const taken = new Set([
      ...listFixes(folder.path).map(fix => fix.slug),
      ...app.branches.of(folder.id).filter(other => other.design.startsWith('fixes/')).map(other => other.design.slice(6)),
    ]);
    const made = app.asked.create(folder, { title: said.text ? titleFrom(said.text) : 'Images', taken });
    if (made.error) return sessionPageComposer(422, null, { message: said.text, $errors: { message: made.error } });
    app.drafts.move(folder, design, folder, made.fix);
    tell(app, { projects: true });
    const fields = [...form.entries()].filter(([, value]) => typeof value === 'string');
    return startConversation({ req, res, page, app, folder, design: made.fix, fields });
  }
  if (starting && sessionId !== 'new') return notFound();

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
    // A fix's page is its own address, showing its latest session (prelude/fix-something).
    return redirect(res, design.kind === 'fix' ? base : `${base}/sessions/${session.id}`);
  }

  /** The message box, answering a form: refused, or afresh. */
  function sessionPageComposer(status, session, extraModel = {}, also = '') {
    return sendView(status, '_composer', pageModel({ session, extra: extraModel }), also);
  }

  const session = sessionId && readSession(dir, sessionId);
  if (!session) return notFound();

  if (action === undefined && req.method === 'GET') {
    // Opened: a turn it finished no longer needs the person (R-8hc).
    app.seen.mark(seenKey(folder, design, session.id));
    tell(app, { needs: true });
    return session.build ? buildSessionPage(200, session) : sessionPage(200, session);
  }

  // A build session's check (prelude/build):
  //   GET  …/sessions/:session/check                 every screen
  //   GET  …/sessions/:session/check/tally           the check in a few words
  //   GET  …/sessions/:session/check/:shot           one screen; ?show= built, approved or differences
  //   POST …/sessions/:session/check/:shot/approve   approve it as built: that screen alone (R-f6w)
  //   POST …/sessions/:session/check/:shot/fix       ask the agent to fix it, as a message
  //   POST …/sessions/:session/app/start             start the app from this branch (approve=true:
  //                                                  approve it first), and come back
  // The app build's and the shell's layouts', which have no screens of their own:
  //   GET  …/sessions/:session/result                whether the app starts, and what the build changed
  //   POST …/sessions/:session/result/fix            ask the agent to make the app start, with its log
  // A part asked for cold is the page.
  if (deeper) {
    const kind = buildKind(session);
    if (!kind || (action === 'check' && kind !== 'page') || (action === 'result' && kind === 'page')) return notFound();
    const sessionUrl = `${base}/sessions/${session.id}`;
    const checkUrl = `${sessionUrl}/check`;
    const [shotId, verb, ...beyond] = extra;
    if (beyond.length) return notFound();
    const part = (status, view, data, also = '') => (fragment && askedFromLayout(req, 'app') ? sendView(status, view, data, also) : buildSessionPage(status, session));

    /** A message from the person, sent now, or waiting while the agent works (R-z4k). `prompt`: what the agent is told. */
    const ask = (text, prompt = text) => {
      const item = { sessionId: session.id, text, images: [], lookingAt: null, prompt };
      if (turns.busy(folder, design)) {
        turns.enqueue(folder, design, item);
        live.publish(sessionKey(folder, design, session.id), statusMessage(turns.state(folder, design, session.id)));
        return fragment ? send(res, 200, envelope('queued', render('./_queued', pageModel({ session })))) : redirect(res, sessionUrl);
      }
      const started = startTurn(session, [item]);
      if (!fragment) return redirect(res, sessionUrl);
      if (started.error) return send(res, 409, render('./_entry', { entry: { type: 'note', failed: true, text: started.error }, base }));
      return send(res, 200, '');
    };

    // As the project page's Start does: one address serves one branch at a
    // time, so this stops whichever had it. Approving it first is the
    // project's, so every branch has it, as the design bar's approval is.
    // For the app build and the shell's layouts, the start is what the page
    // says about it, a failed one with its log.
    if (action === 'app') {
      if (shotId !== 'start' || verb !== undefined || req.method !== 'POST') return notFound();
      const form = await readForm(req);
      const config = readHostConfig(folder.path);
      if (config && form.get('approve') === 'true') app.hosts.approve(folder.branch ? { id: folder.branch.parentId } : folder, config);
      if (config && app.hosts.approved(folder, config)) {
        if (kind === 'page') {
          try { await app.hosts.start(folder, config); } catch { /* its log says why */ }
        } else if (!turns.busy(folder, design)) {
          await startApp(session);
        }
      }
      tell(app, { projects: true });
      return redirect(res, sessionUrl);
    }

    if (action === 'result') {
      if (shotId === undefined && req.method === 'GET') return part(200, 'build/_result', buildSessionView(session));
      // The person's words show; the agent is also told what the app printed.
      if (shotId === 'fix' && verb === undefined && req.method === 'POST') {
        const form = await readForm(req);
        const text = String(form.get('message') ?? '').trim() || 'The app doesn’t start from this branch. Make it start.';
        const log = readResult(dir, session.id)?.start?.log?.trim() ?? '';
        return ask(text, log ? `${text}\n\n(From Prelude: starting it ended with this.)\n\n${log.split('\n').slice(-40).join('\n')}` : text);
      }
      return notFound();
    }

    if (shotId === undefined && req.method === 'GET') return part(200, 'build/_check', buildSessionView(session));
    if (shotId === 'tally' && verb === undefined && req.method === 'GET') return part(200, 'build/_tally', buildSessionView(session).check);
    const shot = checkOf(session).shots.find(one => one.id === shotId);
    if (!shot) return notFound();
    const shotModel = () => shotView(checkOf(session), shot.id, { url: checkUrl, query: Object.fromEntries(url.searchParams.entries()) });
    if (verb === undefined && req.method === 'GET') return part(200, 'build/_shot', shotModel());

    // Approve it as built: this screen, as it renders now, becomes its
    // approved screen, and no other does (R-f6w). Kept on the branch.
    if (verb === 'approve' && req.method === 'POST') {
      await readForm(req);
      const rendered = await renderPath({ renderers: app.renderers, hosts: app.hosts }, { folder, design, designDir: dir, path: shot.path, stateId: shot.stateId });
      const ok = rendered.status === 200;
      if (ok) {
        writeSnapshot(dir, shot.key, rendered.html);
        if (entry && !turns.busy(folder, design)) {
          try { app.branches.commit(entry, `${design.title}: ${shot.page} in ${shot.state}, approved as built (committed by Prelude)`); } catch (error) { console.error(error); }
        }
      }
      const kept = checkOf(session);
      const now = ({ error: _, ...one }) => (ok ? { ...one, status: 'matches' } : { ...one, status: 'fails', error: rendered.error ?? `It answered ${rendered.status}.` });
      writeCheck(dir, session.id, { ...kept, shots: kept.shots.map(one => (one.id === shot.id ? now(one) : one)) });
      if (!fragment) return redirect(res, `${checkUrl}/${shot.id}`);
      return sendView(ok ? 200 : 409, 'build/_shot', shotModel(), envelope('check-tally', render('./build/_tally', buildSessionView(session).check)));
    }

    // Ask the agent to fix it: the form's message, sent as the person's, or
    // waiting while the agent works (R-z4k). The transcript has it from the
    // session's channel, as every message the agent is sent.
    if (verb === 'fix' && req.method === 'POST') {
      const form = await readForm(req);
      return ask(String(form.get('message') ?? '').trim() || `${shot.page} in ${shot.state} differs from its approved screen. Make it match the design.`);
    }
    return notFound();
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
      app.drafts.restore(folder, design, session.id, { message: said.text, images: images.map(image => ({ id: image.id, name: image.name, path: fileOf(image.file) })) });
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
        images: waiting.flatMap(item => item.images.map(image => ({ id: image.id, name: image.name, path: fileOf(image.file) }))),
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
    const shown = url.searchParams.get('streaming') || null;
    return openChannel([sessionKey(folder, design, session.id)], turns.catchUp(folder, design, dir, session.id, from, view, shown));
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
