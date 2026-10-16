// Prelude's server: plain node:http, a handful of routes, views in Eta.
//
// Koda's contract (koda-server-setup): read x-koda-fragment, answer one URL in
// two shapes, and put `Vary: x-koda-fragment` and `x-koda: 1` on every
// response the application produces, including its own refusals.

import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appBuildPrompt, buildPrompt, createCliRunner } from './agent.js';
import { PRELUDE_DIR, createDesign, designIdOf, findDesign, findShell, findSystem, groupByArea, listDesigns } from './designs.js';
import { datasetOf, designHostOf, designOrigin, handleDesignHost, isHosted, listStates, matchRoute, pickable, readPostRoutes, readRoutes, reviewDesign, shellLayoutLinks } from './host.js';
import { readSnapshots, writeSnapshots } from './snapshots.js';
import { backlogOf, incrementStory, storyMarkdown } from './backlog.js';
import { incrementOf } from './increment.js';
import { baselineOf, buildable, createBranches, designCommitsSince, gitState, mainBranch, remoteOf, textAt } from './branches.js';
import { DEFAULT_STACK, appOf, chooseStack } from './app-config.js';
import { createHosts, readHostConfig } from './hosts.js';
import { createRenderers } from './renderers.js';
import { canonical, cleanPath, createFolders, createReferences, refuseFolder } from './folders.js';
import { createDesignState, designChannel } from './design-state.js';
import { createLive } from './live.js';
import { createWatches, listScreens, servePreludeFile } from './preview.js';
import { appendEntry, createSession, listSessions, readEntries, readSession, titleFrom } from './sessions.js';
import { createTurns, designKey, sessionKey } from './turns.js';
import { presentEntry, render, shaped } from './views.js';

const here = dirname(fileURLToPath(import.meta.url));
const kodaDir = dirname(fileURLToPath(import.meta.resolve('@kodalang/core')));
// The Koda package itself (its docs and skills), canonical so the agent's
// --add-dir matches the paths its tools use.
const kodaPackage = canonical(dirname(kodaDir));
const kodaVersion = JSON.parse(readFileSync(join(kodaPackage, 'package.json'), 'utf8')).version;

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
  // Keep idle connections well past a client's own idle timeout (Node's default
  // is 5s): git runs synchronously here, and a request sent on a connection the
  // server is just closing is reset - a form post included, which no browser retries.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
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
  // How the desktop app knows a Prelude server, not something else, is on its port.
  // A length, not chunks, so the shell's few lines of HTTP can read it.
  if (path === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': 7, 'cache-control': 'no-store' });
    return res.end('prelude');
  }

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
    if (!folder) return page(404, 'not-found', { what: 'That project isn’t in your recent projects. Open it again from the home page.' }, 'Not found');
    if (refuseFolder(folder.path)) {
      return page(404, 'not-found', { what: `${folder.path} is no longer there.`, forget: `/f/${folder.id}/forget` }, 'Not found');
    }
    const rest = folderMatch[2] ?? '';

    // Step 9: in a git repository, every design works on a branch of its own,
    // in a worktree that is a folder too. `folder.branch` is set in one.
    const repository = !folder.branch && gitState(folder.path) === 'repository';
    const blank = { title: '', area: '', errors: {} };

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

    // A design's branch as the folder page shows it: where it stands, and its links.
    const workOf = design => {
      const entry = !folder.branch && app.branches.forDesign(folder.id, design.id);
      return entry ? branchState(app, entry, design) : null;
    };

    // The folder: its designs (each with its branch), the app, and "New design".
    const view = (status, form, reference = { value: '', error: null }, extra = {}) => {
      const designs = designsHere().map(design => ({ ...design, work: workOf(design) }));
      const shell = designs.find(design => design.kind === 'shell') ?? null;
      const shellWork = shell?.work ?? null;
      // In progress (step 10): each design with a branch, and the stories on it -
      // its new and changed groups, or those still to build.
      const inProgress = designs.filter(design => design.work).map(design => {
        const dir = join(design.work.path, PRELUDE_DIR, ...design.id.split('/'));
        const stories = isHosted(dir) && buildsPages(design)
          ? groupsOf(app, { entry: design.work, design, dir }).groups.filter(group => group.kind !== 'unchanged')
            .map(group => ({ title: group.title, kind: group.kind, toBuild: group.toBuild, summary: group.change?.summary ?? '', story: group.story }))
          : [];
        return { design, work: design.work, stories, buildUrl: `${design.work.url}/build` };
      });
      const allStories = inProgress.flatMap(item => item.stories.filter(story => story.toBuild).map(story => story.story)).join('\n\n---\n\n');
      return page(status, 'folder', {
        folder,
        groups: groupByArea(designs.filter(design => !design.work)),
        inProgress,
        allStories,
        system: designs.find(design => design.kind === 'system') ?? null,
        shell,
        form,
        references: app.references.of(folder.id),
        reference,
        app: appOf(folder.path),
        // The app built on the shell's branch, not yet merged into main.
        appOnBranch: Boolean(shellWork && appOf(shellWork.path).built && !appOf(folder.path).built),
        shellWork,
        defaultStack: DEFAULT_STACK,
        canBuild: !folder.branch && buildable(folder.path),
        git: gitState(folder.path),
        merged: folder.branch ? [] : app.branches.merged(folder.id).slice(0, 5),
        appError: null,
        finishError: null, // { id, message }: finishing that branch failed; shown beside its buttons
        confirmPublish: null,
        published: null,
        ...extra,
      }, `${folder.name} · Prelude`);
    };

    // Remove the worktrees and branches of designs merged into main (here, or
    // by a pull request on the server), at most every 30 seconds per folder.
    const tidy = () => {
      if (!repository || Date.now() - (app.tidied.get(folder.id) ?? 0) < app.tidyEvery) return;
      app.tidied.set(folder.id, Date.now());
      try {
        app.branches.tidy(folder, { beforeRemove: entry => app.hosts.stop({ path: entry.path }) });
      } catch { /* git couldn't say: try again next time */ }
    };

    // A design's branch, made if it has none; for a folder that isn't a
    // repository yet, making one makes it one. { entry, worktree } or { error }.
    const branchFor = (designId, title) => {
      const made = app.branches.ensure({ folder, designId, title });
      return made.error ? made : { entry: made.entry, worktree: app.folders.get(made.entry.id) };
    };

    // Finish a design's branch: merge it into main here, publish it for a pull
    // request (after the person confirms), or bring main into it.
    const finishMatch = rest.match(/^\/branches\/([0-9a-f]+)\/(merge|publish|update|abandon)$/);
    if (finishMatch && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      const entry = app.folders.get(finishMatch[1])?.branch;
      if (!entry || entry.parentId !== folder.id) return redirect(res, `/f/${folder.id}`);
      const design = listDesigns(entry.path).find(candidate => candidate.id === entry.design) ?? { id: entry.design, title: entry.design };
      const back = String(form.get('back') ?? '');
      const backTo = back.startsWith('/f/') ? back : `/f/${folder.id}`;
      const designPage = `/f/${folder.id}/d/${entry.design}`;
      const action = finishMatch[2];
      // Shown beside the branch's buttons, where the person clicked, and
      // logged: the top of a long page is easily out of sight.
      const finishFailed = (entry, message) => {
        console.error(`Finishing ${entry.branch} failed: ${message}`);
        return view(409, blank, undefined, { finishError: { id: entry.id, message } });
      };
      if (action === 'merge') {
        const merged = app.branches.merge(entry, `Merge ${entry.branch}: ${design.title} (merged by Prelude)`);
        if (merged.error) return finishFailed(entry, merged.error);
        app.tidied.delete(folder.id);
        tidy();
        return redirect(res, designPage);
      }
      if (action === 'update') {
        const updated = app.branches.update(entry);
        noteOnBranch(entry, updated.error
          ? updated.error
          : updated.clashes
          ? `${updated.from} is half brought into this branch: ${updated.clashes.length === 1 ? '1 file clashes' : `${updated.clashes.length} files clash`} (${updated.clashes.join(', ')}), left with git's conflict markers. The agent resolves them with your next message; nothing is committed until it has. Or abandon the update.`
          : updated.files.length ? `Brought ${updated.from} into this branch: ${updated.files.length} ${updated.files.length === 1 ? 'file' : 'files'} came in. The agent is told with your next message.` : `${updated.from} had nothing new for this branch.`, Boolean(updated.error));
        return redirect(res, backTo);
      }
      if (action === 'abandon') {
        noteOnBranch(entry, app.branches.abandon(entry) ? `Abandoned the update from ${mainOf(folder)}: the branch is as it was before it.` : 'git couldn’t abandon the update.');
        return redirect(res, backTo);
      }
      // Publish: push and open a pull request, once the person has said yes.
      if (form.get('confirm') !== 'yes') {
        return view(200, blank, undefined, { confirmPublish: { id: entry.id, branch: entry.branch, design: design.title, remote: remoteOf(folder.path)?.url, back: backTo } });
      }
      const body = pullRequestBody(app, entry, design);
      const published = app.branches.publish(entry, { title: `${design.title} (designed and built with Prelude)`, body });
      if (published.error) return finishFailed(entry, published.error);
      noteOnBranch(entry, published.pr ? `Pushed ${entry.branch} and opened a pull request: ${published.pr}` : `Pushed ${entry.branch}. Open the pull request here: ${published.compare ?? 'on your Git server'}`);
      return view(200, blank, undefined, { published: { branch: entry.branch, pr: published.pr, compare: published.compare } });
    }

    // Build the app (step 8): in a build session on the folder's shell's
    // branch, the shell made if there isn't one. Starting it settles the stack
    // if nobody had.
    if (rest === '/app/build' && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      let state = appOf(folder.path);
      if (!state.stack) state = chooseStack(folder.path, String(form.get('stack') ?? '').trim() || DEFAULT_STACK);
      if (state.built) return redirect(res, `/f/${folder.id}#app`);
      let shell = designsHere().find(design => design.kind === 'shell');
      let made;
      if (!shell) {
        made = branchFor('app-shell', 'App shell');
        if (made.error) return view(409, blank, undefined, { appError: made.error });
        const created = createDesign(made.entry.path, { title: 'App shell', kind: 'shell' });
        if (created.errors) return view(409, blank, undefined, { appError: Object.values(created.errors)[0] });
        app.branches.commit(made.entry, 'App shell: a new design (committed by Prelude)');
        shell = created.design;
      } else {
        made = branchFor(shell.id, shell.title);
        if (made.error) return view(409, blank, undefined, { appError: made.error });
      }
      return startGroupBuild({ req, res, page, app, folder: made.worktree, designId: shell.id, groupKey: APP_GROUP.key });
    }

    if (rest === '' && req.method === 'GET') {
      folders.open(folder.path);
      tidy();
      return view(200, blank);
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
    if (rest === '/references' && req.method === 'POST') {
      const value = cleanPath((await readForm(req)).get('path'));
      const added = app.references.add(folder, value);
      if (added.error) return view(422, blank, { value, error: added.error });
      return redirect(res, `/f/${folder.id}`);
    }

    if (rest === '/references/remove' && req.method === 'POST') {
      app.references.remove(folder.id, String((await readForm(req)).get('path') ?? ''));
      return redirect(res, `/f/${folder.id}`);
    }

    if (rest === '/designs' && req.method === 'POST' && !folder.branch) {
      const form = await readForm(req);
      const input = { title: form.get('title') ?? '', area: form.get('area') ?? '', kind: ['system', 'shell'].includes(form.get('kind')) ? form.get('kind') : 'design' };
      // Designs of views are written in the app's language (step 8). The first
      // one settles the stack: the default, or one described. A described
      // stack's app, with its design host, is built before any design of views.
      // The design system is plain HTML, so it needs no stack.
      if (input.kind !== 'system') {
        let state = appOf(folder.path);
        if (!state.stack) state = chooseStack(folder.path, String(form.get('stack') ?? '').trim() || DEFAULT_STACK);
        if (state.custom && !state.built) {
          return view(409, { ...input, errors: { kind: `Designs here will be written in ${state.stack}, so its app is built first, with a design host. Start the app build below.` } });
        }
      }
      // In a repository, a new design is made on its own branch.
      if (repository) {
        const id = designIdOf(input);
        const existing = designsHere();
        if (input.kind !== 'design') {
          const same = existing.find(design => design.kind === input.kind);
          if (same) return view(422, { ...input, errors: { kind: `This project already has ${input.kind === 'system' ? 'a design system' : 'an app shell'}: "${same.title}".` } });
        }
        if (!id.split('/').at(-1)) return view(422, { ...input, errors: { title: String(input.title).trim() ? 'The title needs at least one letter or digit.' : 'Give the design a title.' } });
        if (existing.some(design => design.id === id)) return view(422, { ...input, errors: { title: `prelude/${id} already exists.` } });
        const made = branchFor(id, String(input.title).trim());
        if (made.error) return view(409, { ...input, errors: { kind: made.error } });
        const result = createDesign(made.entry.path, input);
        if (result.errors) return view(422, { ...input, errors: result.errors });
        app.branches.commit(made.entry, `${result.design.title}: a new design (committed by Prelude)`);
        return redirect(res, `/f/${made.entry.id}/d/${result.design.id}`);
      }
      const result = createDesign(folder.path, input);
      if (result.errors) return view(422, { ...input, errors: result.errors });
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

/** Whether a design has pages to build: a feature, or the shell's own (its Settings, say). */
const buildsPages = design => design.kind === 'design' || design.kind === 'shell';

/** A shell's gallery: the pages under its views' gallery/, showing its layouts. Never built. */
const isGallery = (design, group) => design.kind === 'shell' && (!group.page || group.page.view.startsWith('gallery/'));

/**
 * A design's groups as its Build page and the folder's "In progress" show
 * them (steps 7 and 10), each with:
 *   kind    'new' (not on main), 'changed' (differs on its branch), 'to build'
 *           (on main, not built yet) or 'unchanged' (built, and no change)
 *   change  the increment (increment.js), on a branch
 *   toBuild whether a build session is still due: a changed group is built
 *           once a build of it has finished since its last design change
 *   story   the increment's story for a changed group, the whole group's otherwise
 * { groups, designWide, shared }.
 */
function groupsOf(app, { entry, design, dir }) {
  const designPath = `${PRELUDE_DIR}/${design.id}`;
  const backlog = backlogOf(dir);
  const groups = backlog.groups.filter(group => !isGallery(design, group));
  const { designWide } = backlog;
  const states = listStates(dir);
  const approved = Boolean(readSnapshots(dir));
  let increment = null;
  let shared = [];
  let repo = null;
  if (entry) {
    try {
      repo = entry.repo ?? app.folders.get(entry.parentId)?.path ?? null;
      const base = repo && baselineOf(repo, entry.branch);
      const ext = readHostConfig(entry.path)?.views ?? '.eta';
      if (base) increment = incrementOf({ repo, base, designId: design.id, designDir: dir, ext });
      shared = app.branches.status(entry).alsoChanges;
    } catch { /* git couldn't say: whole stories, as without a branch */ }
  }
  return {
    designWide,
    shared,
    groups: groups.map(group => {
      const change = increment?.groups.get(group.key) ?? null;
      const changed = change?.status === 'changed';
      const kind = changed ? 'changed' : change?.status === 'new' ? 'new' : group.built ? 'unchanged' : 'to build';
      const builtAt = entry?.built?.[group.key];
      const builtSince = Boolean(builtAt && repo && designCommitsSince(repo, builtAt, entry.branch, design.id).length === 0);
      const toBuild = changed ? !(group.built && builtSince) : !group.built;
      const story = changed
        ? incrementStory({ design, designPath, group, change, states, shared })
        : storyMarkdown({ design, designPath, group, designWide, states, approved });
      return { ...group, kind, change, toBuild, story };
    }),
  };
}

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
  const surface = (view, extra = {}) => {
    const common = {
      mode: 'design',
      ...extra,
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
      // Ported routes render the app's own views; the rest are the design's.
      const ported = { count: routes.filter(route => route.ported).length, of: routes.length };
      const approved = readSnapshots(dir)?.size ?? 0;
      const built = appHere();
      const mode = built ? common.mode : 'design';
      // In App mode the frame is the app itself, at the same path, with its own data.
      const at = current && (mode === 'app' ? `${built.url}${current.id}` : `${origin}${current.id}`);
      return { ...common, mode, app: built, hosted: true, screens, current, states, state, changed, ported, approved, frame: at, open: at };
    }
    const screens = listScreens(dir);
    const wanted = designs.current(dKey);
    const current = screens.find(screen => screen.id === wanted) ?? screens[0] ?? null;
    const files = `${previewOrigin(req)}/f/${folder.id}/p/${design.id}`;
    const at = current && `${files}/screens/${encodeURIComponent(current.file)}`;
    return { ...common, mode: 'design', app: null, hosted: false, screens, current, states: [], state: null, changed: false, frame: at, open: at };
  };

  if (req.method === 'GET' && rest[0] === 'preview' && rest.length === 1) {
    return page(200, 'design', surface(viewOf(url.searchParams.get('view')), { mode: modeOf(url.searchParams.get('mode')) }), title);
  }

  if (req.method === 'POST' && rest[0] === 'screen' && rest.length === 1) {
    const form = await readForm(req);
    const view = viewOf(form.get('view'));
    const wanted = String(form.get('screen') ?? '');
    const known = hosted
      ? Boolean(matchRoute(readRoutes(dir), wanted))
      : listScreens(dir).some(screen => screen.id === wanted);
    if (known) designs.show(dKey, wanted);
    return send(res, 200, render('./_design', surface(view, { mode: modeOf(form.get('mode')) })));
  }

  // "Reset data": throw away what forms changed, back to the state's file.
  if (req.method === 'POST' && rest[0] === 'reset' && rest.length === 1) {
    const form = await readForm(req);
    designs.resetCopy(dKey);
    return send(res, 200, render('./_design', surface(viewOf(form.get('view')), { mode: modeOf(form.get('mode')) })));
  }

  if (req.method === 'POST' && rest[0] === 'state' && rest.length === 1) {
    const form = await readForm(req);
    const wanted = String(form.get('state') ?? '');
    if (listStates(dir).some(state => state.id === wanted)) designs.showState(dKey, wanted);
    return send(res, 200, render('./_design', surface(viewOf(form.get('view')), { mode: modeOf(form.get('mode')) })));
  }

  // "Approve these screens": every page in every state, as it renders now,
  // becomes the design's snapshots, which the check then compares against.
  if (req.method === 'POST' && rest[0] === 'approve' && rest.length === 1 && hosted) {
    const form = await readForm(req);
    const review = await reviewDesign({ renderers: app.renderers, hosts: app.hosts }, { folder, design, designDir: dir });
    // Approving over pages that don't render would throw their approved versions away.
    const states = Math.max(1, listStates(dir).length);
    const count = review.failures.length ? 0 : writeSnapshots(dir, review.renders);
    const notice = review.failures.length
      ? `Not approved: ${review.failures.length === 1 ? '1 page doesn’t' : `${review.failures.length} pages don’t`} render. Fix ${review.failures.length === 1 ? 'it' : 'them'} first.`
      : `Approved ${count} ${count === 1 ? 'page' : 'pages'} in ${states} ${states === 1 ? 'state' : 'states'}.`;
    return send(res, 200, render('./_design', surface(viewOf(form.get('view')), { notice, mode: modeOf(form.get('mode')) })));
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

  // The folder this design's folder belongs to: itself, or (in a design's
  // worktree) the repository it's a branch of. What the agent may read, and
  // where finishing happens, are the folder's.
  const parentId = folder.branch?.parentId ?? folder.id;
  const entry = folder.branch?.design === design.id ? folder.branch : null;

  const sessionView = (status, session, composer) => {
    const entries = session ? readEntries(dir, session.id) : [];
    const sessionUrl = session && `${base}/sessions/${session.id}`;
    const branch = entry && (() => {
      const state = branchState(app, entry, design);
      return {
        ...state,
        finish: `/f/${parentId}/branches/${entry.id}`,
        back: session ? sessionUrl : base,
        building: session?.build ?? null,
      };
    })();
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
      references: app.references.of(parentId),
      buildUrl: hosted && buildsPages(design) ? `${base}/build` : null,
      branch,
      merged: app.branches.merged(parentId).find(note => note.design === design.id) ?? null,
    }, title);
  };

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
    // A shell layout that now names the app's file (layouts.json) has no copy of its own.
    if (design.kind === 'shell') for (const name of Object.keys(shellLayoutLinks(dir))) rmSync(join(dir, 'layouts', `${name}${readHostConfig(folder.path)?.views ?? '.eta'}`), { force: true });
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
      done = Boolean(build.group === APP_GROUP.key ? appOf(folder.path).built : backlogOf(dir).groups.find(g => g.key === build.group)?.built);
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
    return {
      mode: 'build',
      systemPrompt: isApp
        ? appBuildPrompt({ folderPath: folder.path, stack: appOf(folder.path).stack ?? DEFAULT_STACK, shell: design, designs: listDesigns(folder.path), system: systemFor(), branch: entry.branch, references, kodaPath: kodaPackage, kodaVersion })
        : buildPrompt({ title: design.title, designPath: `${PRELUDE_DIR}/${design.id}`, group, change: group.kind === 'changed' ? group.change : null, designWide: backlog.designWide, branch: entry.branch, references, stack, kodaPath: kodaPackage }),
    };
  };

  // The Build view: what's left to build, as groups to copy as stories or build.
  const buildView = (extra = {}) => {
    const designPath = `${PRELUDE_DIR}/${design.id}`;
    const { groups, designWide } = groupsOf(app, { entry, design, dir });
    const appHere = appOf(folder.path);
    let appOnMain = appHere.built;
    try { appOnMain = entry ? appOf(app.folders.get(parentId).path).built : appHere.built; } catch { /* the folder's gone */ }
    return {
      folder, design, base, designPath, designWide,
      // What's to build shows; what's built and unchanged folds away (step 10).
      groups: groups.filter(group => group.kind !== 'unchanged'),
      unchanged: groups.filter(group => group.kind === 'unchanged'),
      // Building happens on the design's branch, into the app, one group at a time.
      // (A design with no branch yet builds too: starting makes its branch.)
      canBuild: (entry ? appHere.built : !folder.branch && buildable(folder.path) && appHere.built)
        && !(entry?.building && entry.building.group !== APP_GROUP.key && groups.some(g => g.key === entry.building.group && g.toBuild)),
      building: entry?.building ?? null,
      app: appHere,
      appOnMain,
      updateUrl: entry && `/f/${parentId}/branches/${entry.id}/update`,
      appUrl: `/f/${parentId}#app`,
      error: null,
      ...extra,
    };
  };
  if (req.method === 'GET' && rest[0] === 'build' && rest.length === 1 && hosted && buildsPages(design)) {
    return page(200, 'build', buildView(), `Build · ${title}`);
  }

  // Build a group on the design's branch: a build session, briefed from the
  // group, its first turn started. The app build (group @app) is the shell's.
  if (req.method === 'POST' && rest[0] === 'builds' && rest.length === 1 && entry) {
    const key = String((await readForm(req)).get('group') ?? '');
    const isApp = key === APP_GROUP.key && design.kind === 'shell';
    const work = buildsPages(design) && hosted ? groupsOf(app, { entry, design, dir }).groups : [];
    const group = isApp ? APP_GROUP : work.find(g => g.key === key) ?? null;
    const refuse = error => page(409, 'build', buildView({ error }), `Build · ${title}`);
    if (!group) return page(422, 'build', buildView({ error: 'That group is no longer in the design.' }), `Build · ${title}`);
    // Features are built into the app, so the app comes first (step 8), and
    // must be on this branch too.
    if (!isApp && !appOf(folder.path).built) {
      return refuse(buildView().appOnMain
        ? 'The app is on main, but not on this design’s branch yet. Bring main into the branch first (Update from main).'
        : 'The app isn’t built yet. Build it first, from the project page.');
    }
    if (!isApp && entry.building && entry.building.group !== key && work.some(g => g.key === entry.building.group && g.toBuild)) {
      return refuse(`This design is building ${entry.building.title} now. Groups are built one at a time.`);
    }
    if (turns.state(folder, design, null).kind !== 'idle') return refuse('The agent is working on this design. Wait for it to finish.');
    app.branches.building(entry, group);
    const message = isApp ? 'Build the app.' : `Build ${group.title}.`;
    const session = createSession(dir, { title: isApp ? 'Build the app' : `Build: ${group.title}`, build: { group: group.key, title: group.title } });
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${base}/sessions/${session.id}/stop`, ...agentContext(session) });
    if (started.error) return refuse(started.error);
    return redirect(res, `${base}/sessions/${session.id}`);
  }

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
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${base}/sessions/${session.id}/stop`, ...agentContext(session) });
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
    const started = turns.start({ folder, design, designDir: dir, sessionId: session.id, message, stopUrl: `${sessionUrl}/stop`, ...agentContext(session) });
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
  // A post with no form at all (no body, no type) is an empty form, not an error.
  if (!body.length && !/form/i.test(type)) return new FormData();
  // Koda posts FormData (multipart); a browser without script posts urlencoded.
  // Let the platform parse either - never decode multipart as text by hand.
  const request = new Request('http://localhost/', { method: 'POST', headers: { 'content-type': type }, body });
  return request.formData();
}
